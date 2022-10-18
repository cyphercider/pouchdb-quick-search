import { flatten } from "pouchdb-utils"
import { toIndexableString, parseIndexableString } from "pouchdb-collate"
import { uniq } from "pouchdb-mapreduce-utils"
import Promise from "pouchdb-promise"
import { rowToDocId } from "./index"
import { reduceView } from "./reduceView"

export function queryViewInQueue(view, opts) {
  let totalRows
  const shouldReduce = view.reduceFun && opts.reduce !== false
  const skip = opts.skip || 0
  if (typeof opts.keys !== "undefined" && !opts.keys.length) {
    // equivalent query
    opts.limit = 0
    delete opts.keys
  }

  function fetchFromView(viewOpts) {
    viewOpts.include_docs = true
    return view.db.allDocs(viewOpts).then(function (res) {
      totalRows = res.total_rows
      return res.rows.map(function (result) {
        // implicit migration - in older versions of PouchDB,
        // we explicitly stored the doc as {id: ..., key: ..., value: ...}
        // this is tested in a migration test
        /* istanbul ignore next */
        if (
          "value" in result.doc &&
          typeof result.doc.value === "object" &&
          result.doc.value !== null
        ) {
          const keys = Object.keys(result.doc.value).sort()
          // this detection method is not perfect, but it's unlikely the user
          // emitted a value which was an object with these 3 exact keys
          const expectedKeys = ["id", "key", "value"]
          if (!(keys < expectedKeys || keys > expectedKeys)) {
            return result.doc.value
          }
        }

        const parsedKeyAndDocId = parseIndexableString(result.doc._id)
        return {
          key: parsedKeyAndDocId[0],
          id: parsedKeyAndDocId[1],
          value: "value" in result.doc ? result.doc.value : null,
        }
      })
    })
  }

  function onMapResultsReady(rows) {
    let finalResults
    if (shouldReduce) {
      finalResults = reduceView(view, rows, opts)
    } else {
      finalResults = {
        total_rows: totalRows,
        offset: skip,
        rows: rows,
      }
    }
    if (opts.include_docs) {
      const docIds = uniq(rows.map(rowToDocId))

      return view.sourceDB
        .allDocs({
          keys: docIds,
          include_docs: true,
          conflicts: opts.conflicts,
          attachments: opts.attachments,
          binary: opts.binary,
        })
        .then(function (allDocsRes) {
          const docIdsToDocs = {}
          allDocsRes.rows.forEach(function (row) {
            if (row.doc) {
              docIdsToDocs["$" + row.id] = row.doc
            }
          })
          rows.forEach(function (row) {
            const docId = rowToDocId(row)
            const doc = docIdsToDocs["$" + docId]
            if (doc) {
              row.doc = doc
            }
          })
          return finalResults
        })
    } else {
      return finalResults
    }
  }

  if (typeof opts.keys !== "undefined") {
    const keys = opts.keys
    const fetchPromises = keys.map(function (key) {
      const viewOpts = {
        startkey: toIndexableString([key]),
        endkey: toIndexableString([key, {}]),
      }
      return fetchFromView(viewOpts)
    })
    return Promise.all(fetchPromises).then(flatten).then(onMapResultsReady)
  } else {
    // normal query, no 'keys'
    const viewOpts = {
      descending: opts.descending,
      startkey: undefined,
      endkey: undefined,
      limit: undefined,
      skip: undefined,
    }
    if (opts.start_key) {
      opts.startkey = opts.start_key
    }
    if (opts.end_key) {
      opts.endkey = opts.end_key
    }
    if (typeof opts.startkey !== "undefined") {
      viewOpts.startkey = opts.descending
        ? toIndexableString([opts.startkey, {}])
        : toIndexableString([opts.startkey])
    }
    if (typeof opts.endkey !== "undefined") {
      let inclusiveEnd = opts.inclusive_end !== false
      if (opts.descending) {
        inclusiveEnd = !inclusiveEnd
      }

      viewOpts.endkey = toIndexableString(
        inclusiveEnd ? [opts.endkey, {}] : [opts.endkey]
      )
    }
    if (typeof opts.key !== "undefined") {
      const keyStart = toIndexableString([opts.key])
      const keyEnd = toIndexableString([opts.key, {}])
      if (viewOpts.descending) {
        viewOpts.endkey = keyStart
        viewOpts.startkey = keyEnd
      } else {
        viewOpts.startkey = keyStart
        viewOpts.endkey = keyEnd
      }
    }
    if (!shouldReduce) {
      if (typeof opts.limit === "number") {
        viewOpts.limit = opts.limit
      }
      viewOpts.skip = skip
    }
    return fetchFromView(viewOpts).then(onMapResultsReady)
  }
}
