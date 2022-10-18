import { sequentialize } from "pouchdb-mapreduce-utils"
import Promise from "pouchdb-promise"
import { parseViewName, getQueue, defaultsTo } from "./index"

export function localViewCleanup(db) {
  return db.get("_local/mrviews").then(function (metaDoc) {
    const docsToViews = {}
    Object.keys(metaDoc.views).forEach(function (fullViewName) {
      const parts = parseViewName(fullViewName)
      const designDocName = "_design/" + parts[0]
      const viewName = parts[1]
      docsToViews[designDocName] = docsToViews[designDocName] || {}
      docsToViews[designDocName][viewName] = true
    })
    const opts = {
      keys: Object.keys(docsToViews),
      include_docs: true,
    }
    return db.allDocs(opts).then(function (res) {
      const viewsToStatus = {}
      res.rows.forEach(function (row) {
        const ddocName = row.key.substring(8)
        Object.keys(docsToViews[row.key]).forEach(function (viewName) {
          let fullViewName = ddocName + "/" + viewName
          /* istanbul ignore if */
          if (!metaDoc.views[fullViewName]) {
            // new format, without slashes, to support PouchDB 2.2.0
            // migration test in pouchdb's browser.migration.js verifies this
            fullViewName = viewName
          }
          const viewDBNames = Object.keys(metaDoc.views[fullViewName])
          // design doc deleted, or view function nonexistent
          const statusIsGood =
            row.doc && row.doc.views && row.doc.views[viewName]
          viewDBNames.forEach(function (viewDBName) {
            viewsToStatus[viewDBName] =
              viewsToStatus[viewDBName] || statusIsGood
          })
        })
      })
      const dbsToDelete = Object.keys(viewsToStatus).filter(function (
        viewDBName
      ) {
        return !viewsToStatus[viewDBName]
      })
      const destroyPromises = dbsToDelete.map(function (viewDBName) {
        return sequentialize(getQueue(viewDBName), function () {
          return new db.constructor(viewDBName, db.__opts).destroy()
        })()
      })
      return Promise.all(destroyPromises).then(function () {
        return { ok: true }
      })
    })
  }, defaultsTo({ ok: true }))
}
