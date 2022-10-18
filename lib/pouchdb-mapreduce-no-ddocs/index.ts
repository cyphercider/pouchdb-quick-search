import { flatten, guardedConsole } from "pouchdb-utils"

import { base64StringToBlobOrBuffer as b64ToBluffer } from "pouchdb-binary-utils"

import { collate } from "pouchdb-collate"

import TaskQueue from "./taskqueue"
import {
  callbackify,
  sequentialize,
  promisedCallback,
} from "pouchdb-mapreduce-utils"
import Promise from "pouchdb-promise"
import inherits from "inherits"
import { queryPromised } from "./queryPromised"
import { localViewCleanup } from "./localViewCleanup"
import { queryViewInQueue } from "./queryViewInQueue"
import { updateViewInQueue } from "./updateViewInQueue"
import { getDocsToPersist } from "./getDocsToPersist"

const persistentQueues = {}
export const tempViewQueue = new TaskQueue()
export const CHANGES_BATCH_SIZE = 50

export const log = guardedConsole.bind(null, "log")

export function parseViewName(name) {
  // can be either 'ddocname/viewname' or just 'viewname'
  // (where the ddoc name is the same)
  return name.indexOf("/") === -1 ? [name, name] : name.split("/")
}

export function isGenOne(changes) {
  // only return true if the current change is 1-
  // and there are no other leafs
  return changes.length === 1 && /^1-/.test(changes[0].rev)
}

function emitError(db, e) {
  try {
    db.emit("error", e)
  } catch (err) {
    guardedConsole(
      "error",
      "The user's map/reduce function threw an uncaught error.\n" +
        "You can debug this error by doing:\n" +
        "myDatabase.on('error', function (err) { debugger; });\n" +
        "Please double-check your map/reduce function."
    )
    guardedConsole("error", e)
  }
}

export function tryCode(db, fun, args) {
  // emit an event if there was an error thrown by a map/reduce function.
  // putting try/catches in a single function also avoids deoptimizations.
  try {
    return {
      output: fun.apply(null, args),
    }
  } catch (e) {
    emitError(db, e)
    return { error: e }
  }
}

export function sortByKeyThenValue(x, y) {
  const keyCompare = collate(x.key, y.key)
  return keyCompare !== 0 ? keyCompare : collate(x.value, y.value)
}

export function sliceResults(results, limit, skip) {
  skip = skip || 0
  if (typeof limit === "number") {
    return results.slice(skip, limit + skip)
  } else if (skip > 0) {
    return results.slice(skip)
  }
  return results
}

export function rowToDocId(row) {
  const val = row.value
  // Users can explicitly specify a joined doc _id, or it
  // defaults to the doc _id that emitted the key/value.
  const docId = (val && typeof val === "object" && val._id) || row.id
  return docId
}

function readAttachmentsAsBlobOrBuffer(res) {
  res.rows.forEach(function (row) {
    const atts = row.doc && row.doc._attachments
    if (!atts) {
      return
    }
    Object.keys(atts).forEach(function (filename) {
      const att = atts[filename]
      atts[filename].data = b64ToBluffer(att.data, att.content_type)
    })
  })
}

export function postprocessAttachments(opts) {
  return function (res) {
    if (opts.include_docs && opts.attachments && opts.binary) {
      readAttachmentsAsBlobOrBuffer(res)
    }
    return res
  }
}

function createBuiltInError(name) {
  const message =
    "builtin " +
    name +
    " function requires map values to be numbers" +
    " or number arrays"
  return new BuiltInError(message)
}

export function sum(values) {
  let result: number | number[] = 0
  for (let i = 0, len = values.length; i < len; i++) {
    const num = values[i]
    if (typeof num !== "number") {
      if (Array.isArray(num)) {
        // lists of numbers are also allowed, sum them separately
        result = typeof result === "number" ? [result] : result
        for (let j = 0, jLen = num.length; j < jLen; j++) {
          let jNum = num[j]
          if (typeof jNum !== "number") {
            throw createBuiltInError("_sum")
          } else if (typeof result[j] === "undefined") {
            result.push(jNum)
          } else {
            result[j] += jNum
          }
        }
      } else {
        // not array/number
        throw createBuiltInError("_sum")
      }
    } else if (typeof result === "number") {
      result += num
    } else {
      // add number to array
      result[0] += num
    }
  }
  return result
}

export const builtInReduce = {
  _sum: function (keys, values) {
    return sum(values)
  },

  _count: function (keys, values) {
    return values.length
  },

  _stats: function (keys, values) {
    // no need to implement rereduce=true, because Pouch
    // will never call it
    function sumsqr(values) {
      let _sumsqr = 0
      for (let i = 0, len = values.length; i < len; i++) {
        const num = values[i]
        _sumsqr += num * num
      }
      return _sumsqr
    }
    return {
      sum: sum(values),
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      count: values.length,
      sumsqr: sumsqr(values),
    }
  },
}

export function addHttpParam(paramName, opts, params, asJson?: boolean) {
  // add an http param from opts to params, optionally json-encoded
  let val = opts[paramName]
  if (typeof val !== "undefined") {
    if (asJson) {
      val = encodeURIComponent(JSON.stringify(val))
    }
    params.push(paramName + "=" + val)
  }
}

function coerceInteger(integerCandidate) {
  if (typeof integerCandidate !== "undefined") {
    const asNumber = Number(integerCandidate)
    // prevents e.g. '1foo' or '1.1' being coerced to 1
    if (!isNaN(asNumber) && asNumber === parseInt(integerCandidate, 10)) {
      return asNumber
    } else {
      return integerCandidate
    }
  }
}

function coerceOptions(opts) {
  opts.group_level = coerceInteger(opts.group_level)
  opts.limit = coerceInteger(opts.limit)
  opts.skip = coerceInteger(opts.skip)
  return opts
}

function checkPositiveInteger(number) {
  if (number) {
    if (typeof number !== "number") {
      return new QueryParseError('Invalid value for integer: "' + number + '"')
    }
    if (number < 0) {
      return new QueryParseError(
        "Invalid value for positive integer: " + '"' + number + '"'
      )
    }
  }
}

export function checkQueryParseError(options, fun) {
  const startkeyName = options.descending ? "endkey" : "startkey"
  const endkeyName = options.descending ? "startkey" : "endkey"

  if (
    typeof options[startkeyName] !== "undefined" &&
    typeof options[endkeyName] !== "undefined" &&
    collate(options[startkeyName], options[endkeyName]) > 0
  ) {
    throw new QueryParseError(
      "No rows can match your key range, " +
        "reverse your start_key and end_key or set {descending : true}"
    )
  } else if (fun.reduce && options.reduce !== false) {
    if (options.include_docs) {
      throw new QueryParseError("{include_docs:true} is invalid for reduce")
    } else if (
      options.keys &&
      options.keys.length > 1 &&
      !options.group &&
      !options.group_level
    ) {
      throw new QueryParseError(
        "Multi-key fetches for reduce views must use " + "{group: true}"
      )
    }
  }
  ;["group_level", "limit", "skip"].forEach(function (optionName) {
    const error = checkPositiveInteger(options[optionName])
    if (error) {
      throw error
    }
  })
}

// custom adapters can define their own api._query
// and override the default behavior
/* istanbul ignore next */
export function customQuery(db, fun, opts) {
  return new Promise(function (resolve, reject) {
    db._query(fun, opts, function (err, res) {
      if (err) {
        return reject(err)
      }
      resolve(res)
    })
  })
}

// custom adapters can define their own api._viewCleanup
// and override the default behavior
/* istanbul ignore next */
function customViewCleanup(db) {
  return new Promise(function (resolve, reject) {
    db._viewCleanup(function (err, res) {
      if (err) {
        return reject(err)
      }
      resolve(res)
    })
  })
}

export function defaultsTo(value) {
  return function (reason) {
    /* istanbul ignore else */
    if (reason.status === 404) {
      return value
    } else {
      throw reason
    }
  }
}

// updates all emitted key/value docs and metaDocs in the mrview database
// for the given batch of documents from the source database
export function saveKeyValues(view, docIdsToChangesAndEmits, seq) {
  const seqDocId = "_local/lastSeq"
  return view.db
    .get(seqDocId)
    .catch(defaultsTo({ _id: seqDocId, seq: 0 }))
    .then(function (lastSeqDoc) {
      const docIds = Object.keys(docIdsToChangesAndEmits)
      return Promise.all(
        docIds.map(function (docId) {
          return getDocsToPersist(docId, view, docIdsToChangesAndEmits)
        })
      ).then(function (listOfDocsToPersist) {
        const docsToPersist = flatten(listOfDocsToPersist)
        lastSeqDoc.seq = seq
        docsToPersist.push(lastSeqDoc)
        // write all docs in a single operation, update the seq once
        return view.db.bulkDocs({ docs: docsToPersist })
      })
    })
}

export function getQueue(view) {
  const viewName = typeof view === "string" ? view : view.name
  let queue = persistentQueues[viewName]
  if (!queue) {
    queue = persistentQueues[viewName] = new TaskQueue()
  }
  return queue
}

export function updateView(view) {
  return sequentialize(getQueue(view), function () {
    return updateViewInQueue(view)
  })()
}

export function queryView(view, opts) {
  return sequentialize(getQueue(view), function () {
    return queryViewInQueue(view, opts)
  })()
}

function httpViewCleanup(db) {
  return db.request({
    method: "POST",
    url: "_view_cleanup",
  })
}

const viewCleanup = callbackify(function () {
  const db = this
  if (db.type() === "http") {
    return httpViewCleanup(db)
  }
  /* istanbul ignore next */
  if (typeof db._viewCleanup === "function") {
    return customViewCleanup(db)
  }
  return localViewCleanup(db)
})

function _search_query(fun, opts, callback) {
  if (typeof opts === "function") {
    callback = opts
    opts = {}
  }
  opts = opts ? coerceOptions(opts) : {}

  if (typeof fun === "function") {
    fun = { map: fun }
  }

  if (fun.saveAs) {
    opts.saveAs = fun.saveAs
    delete fun.saveAs
  }

  const db = this
  const promise = Promise.resolve().then(function () {
    return queryPromised(db, fun, opts)
  })
  promisedCallback(promise, callback)
  return promise
}

function QueryParseError(message) {
  this.status = 400
  this.name = "query_parse_error"
  this.message = message
  this.error = true
  try {
    Error.captureStackTrace(this, QueryParseError)
  } catch (e) {}
}

inherits(QueryParseError, Error)

export function NotFoundError(message) {
  this.status = 404
  this.name = "not_found"
  this.message = message
  this.error = true
  try {
    Error.captureStackTrace(this, NotFoundError)
  } catch (e) {}
}

inherits(NotFoundError, Error)

export function BuiltInError(message) {
  this.status = 500
  this.name = "invalid_value"
  this.message = message
  this.error = true
  try {
    Error.captureStackTrace(this, BuiltInError)
  } catch (e) {}
}

inherits(BuiltInError, Error)

export default {
  _search_query: _search_query,
  _search_viewCleanup: viewCleanup,
}
