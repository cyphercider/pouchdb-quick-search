import { upsert } from "pouchdb-utils"
import { stringMd5 } from "pouchdb-md5"

function createView(opts) {
  const sourceDB = opts.db
  const viewName = opts.viewName
  const mapFun = opts.map
  const reduceFun = opts.reduce
  const temporary = opts.temporary
  const saveAs = opts.saveAs

  // the "undefined" part is for backwards compatibility
  const viewSignature =
    mapFun.toString() +
    (reduceFun && reduceFun.toString()) +
    "undefined" +
    (saveAs || "")

  let cachedViews
  if (!temporary) {
    // cache this to ensure we don't try to update the same view twice
    cachedViews = sourceDB._cachedViews = sourceDB._cachedViews || {}
    if (cachedViews[viewSignature]) {
      return cachedViews[viewSignature]
    }
  }

  const promiseForView = sourceDB.info().then(function (info) {
    let depDbName = info.db_name + "-"
    if (saveAs) {
      depDbName += saveAs
    } else {
      depDbName += "mrview-" + (temporary ? "temp" : stringMd5(viewSignature))
    }

    function registerMrView() {
      // save the view name in the source db so it can be cleaned up if necessary
      // (e.g. when the _design doc is deleted, remove all associated view data)
      function diffFunction(doc) {
        doc.views = doc.views || {}
        let fullViewName = viewName
        if (fullViewName.indexOf("/") === -1) {
          fullViewName = viewName + "/" + viewName
        }
        const depDbs = (doc.views[fullViewName] = doc.views[fullViewName] || {})
        /* istanbul ignore if */
        if (depDbs[depDbName]) {
          return // no update necessary
        }
        depDbs[depDbName] = true
        return doc
      }

      return upsert(sourceDB, "_local/mrviews", diffFunction)
    }

    function registerDependentDb() {
      return sourceDB.registerDependentDatabase(depDbName).then(function (res) {
        const db = res.db
        db.auto_compaction = true
        const view = {
          name: depDbName,
          db: db,
          sourceDB: sourceDB,
          adapter: sourceDB.adapter,
          mapFun: mapFun,
          reduceFun: reduceFun,
          seq: undefined,
        }
        return view.db
          .get("_local/lastSeq")
          .catch(function (err) {
            /* istanbul ignore if */
            if (err.status !== 404) {
              throw err
            }
          })
          .then(function (lastSeqDoc) {
            view.seq = lastSeqDoc ? lastSeqDoc.seq : 0
            if (cachedViews) {
              view.db.once("destroyed", function () {
                delete cachedViews[viewSignature]
              })
            }
            return view
          })
      })
    }

    if (viewName) {
      return registerMrView().then(registerDependentDb)
    } else {
      return registerDependentDb()
    }
  })

  if (cachedViews) {
    cachedViews[viewSignature] = promiseForView
  }
  return promiseForView
}

export default createView
