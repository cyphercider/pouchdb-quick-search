import { uniq } from "pouchdb-mapreduce-utils"
import Promise from "pouchdb-promise"
import { isGenOne, defaultsTo } from "./index"

// returns a promise for a list of docs to update, based on the input docId.
// the order doesn't matter, because post-3.2.0, bulkDocs
// is an atomic operation in all three adapters.
export function getDocsToPersist(docId, view, docIdsToChangesAndEmits) {
  const metaDocId = "_local/doc_" + docId
  const defaultMetaDoc = { _id: metaDocId, keys: [] }
  const docData = docIdsToChangesAndEmits[docId]
  let indexableKeysToKeyValues = docData.indexableKeysToKeyValues
  const changes = docData.changes

  function getMetaDoc() {
    if (isGenOne(changes)) {
      // generation 1, so we can safely assume initial state
      // for performance reasons (avoids unnecessary GETs)
      return Promise.resolve(defaultMetaDoc)
    }
    return view.db.get(metaDocId).catch(defaultsTo(defaultMetaDoc))
  }

  function getKeyValueDocs(metaDoc) {
    if (!metaDoc.keys.length) {
      // no keys, no need for a lookup
      return Promise.resolve({ rows: [] })
    }
    return view.db.allDocs({
      keys: metaDoc.keys,
      include_docs: true,
    })
  }

  function processKvDocs(metaDoc, kvDocsRes) {
    const kvDocs = []
    const oldKeysMap = {}

    for (let i = 0, len = kvDocsRes.rows.length; i < len; i++) {
      const row = kvDocsRes.rows[i]
      const doc = row.doc
      if (!doc) {
        // deleted
        continue
      }
      kvDocs.push(doc)
      oldKeysMap[doc._id] = true
      doc._deleted = !indexableKeysToKeyValues[doc._id]
      if (!doc._deleted) {
        const keyValue = indexableKeysToKeyValues[doc._id]
        if ("value" in keyValue) {
          doc.value = keyValue.value
        }
      }
    }

    const newKeys = Object.keys(indexableKeysToKeyValues)
    newKeys.forEach(function (key) {
      if (!oldKeysMap[key]) {
        // new doc
        const kvDoc = {
          _id: key,
          value: undefined,
        }
        const keyValue = indexableKeysToKeyValues[key]
        if ("value" in keyValue) {
          kvDoc.value = keyValue.value
        }
        kvDocs.push(kvDoc)
      }
    })
    metaDoc.keys = uniq(newKeys.concat(metaDoc.keys))
    kvDocs.push(metaDoc)

    return kvDocs
  }

  return getMetaDoc().then(function (metaDoc) {
    return getKeyValueDocs(metaDoc).then(function (kvDocsRes) {
      return processKvDocs(metaDoc, kvDocsRes)
    })
  })
}
