import { collate, toIndexableString, normalizeKey } from "pouchdb-collate"
import TaskQueue from "./taskqueue"
import evalFunc from "./evalfunc"
import Promise from "pouchdb-promise"
import {
  sum,
  log,
  saveKeyValues,
  CHANGES_BATCH_SIZE,
  tryCode,
  sortByKeyThenValue,
} from "./index"

export function updateViewInQueue(view) {
  // bind the emit function once
  let mapResults
  let doc

  function emit(key, value) {
    const output = { id: doc._id, key: normalizeKey(key), value: undefined }
    // Don't explicitly store the value unless it's defined and non-null.
    // This saves on storage space, because often people don't use it.
    if (typeof value !== "undefined" && value !== null) {
      output.value = normalizeKey(value)
    }
    mapResults.push(output)
  }

  let mapFun
  // for temp_views one can use emit(doc, emit), see #38
  if (typeof view.mapFun === "function" && view.mapFun.length === 2) {
    const origMap = view.mapFun

    // TODO - look at these map functions for where these tokens are being provided
    mapFun = function (doc) {
      return origMap(doc, emit)
    }
  } else {
    mapFun = evalFunc(
      view.mapFun.toString(),
      emit,
      sum,
      log,
      Array.isArray,
      JSON.parse
    )
  }

  let currentSeq = view.seq || 0

  function processChange(docIdsToChangesAndEmits, seq) {
    return function () {
      return saveKeyValues(view, docIdsToChangesAndEmits, seq)
    }
  }

  const queue = new TaskQueue()
  // TODO(neojski): https://github.com/daleharvey/pouchdb/issues/1521
  return new Promise(function (resolve, reject) {
    function complete() {
      queue.finish().then(function () {
        view.seq = currentSeq
        resolve()
      })
    }

    function processNextBatch() {
      view.sourceDB
        .changes({
          conflicts: true,
          include_docs: true,
          style: "all_docs",
          since: currentSeq,
          limit: CHANGES_BATCH_SIZE,
        })
        .on("complete", function (response) {
          const results = response.results
          if (!results.length) {
            return complete()
          }
          const docIdsToChangesAndEmits = {}
          for (let i = 0, l = results.length; i < l; i++) {
            const change = results[i]

            if (change.doc._id[0] !== "_") {
              mapResults = []
              doc = change.doc

              if (!doc._deleted) {
                tryCode(view.sourceDB, mapFun, [doc])
              }
              mapResults.sort(sortByKeyThenValue)

              let indexableKeysToKeyValues = {}
              let lastKey
              for (let j = 0, jl = mapResults.length; j < jl; j++) {
                const obj = mapResults[j]
                const complexKey = [obj.key, obj.id]
                if (collate(obj.key, lastKey) === 0) {
                  complexKey.push(j) // dup key+id, so make it unique
                }
                let indexableKey = toIndexableString(complexKey)
                indexableKeysToKeyValues[indexableKey] = obj
                lastKey = obj.key
              }
              docIdsToChangesAndEmits[change.doc._id] = {
                indexableKeysToKeyValues: indexableKeysToKeyValues,
                changes: change.changes,
              }
            }
            currentSeq = change.seq
          }
          queue.add(processChange(docIdsToChangesAndEmits, currentSeq))
          if (results.length < CHANGES_BATCH_SIZE) {
            return complete()
          }
          return processNextBatch()
        })
        .on("error", onError)
      /* istanbul ignore next */
      function onError(err) {
        reject(err)
      }
    }

    processNextBatch()
  })
}
