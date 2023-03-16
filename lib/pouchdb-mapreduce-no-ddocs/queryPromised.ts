import createView from "./createView"
import { fin } from "pouchdb-mapreduce-utils"
import {
  customQuery,
  updateView,
  queryView,
  checkQueryParseError,
  tempViewQueue,
  parseViewName,
  NotFoundError,
} from "./index"

export function queryPromised(db, fun, opts) {
  /* istanbul ignore next */
  if (typeof db._query === "function") {
    return customQuery(db, fun, opts)
  }

  function onViewReady(view) {
    if (opts.stale === "ok" || opts.stale === "update_after") {
      if (opts.stale === "update_after") {
        process.nextTick(function () {
          updateView(view)
        })
      }
      return queryView(view, opts)
    } else {
      // stale not ok
      return updateView(view).then(function () {
        return queryView(view, opts)
      })
    }
  }

  if (opts.saveAs) {
    const autoOptions = {
      db: db,
      saveAs: opts.saveAs,
      map: fun.map,
      reduce: fun.reduce,
    }
    if (opts.destroy) {
      return createView(autoOptions).then(function (view) {
        return view.db.destroy()
      })
    }
    checkQueryParseError(opts, fun)
    return createView(autoOptions).then(onViewReady)
  }

  if (typeof fun !== "string") {
    // temp_view
    checkQueryParseError(opts, fun)

    const createViewOpts = {
      db: db,
      viewName: "temp_view/temp_view",
      map: fun.map,
      reduce: fun.reduce,
      temporary: true,
    }
    tempViewQueue.add(function () {
      return createView(createViewOpts).then(function (view) {
        function cleanup() {
          return view.db.destroy()
        }
        return fin(
          updateView(view).then(function () {
            return queryView(view, opts)
          }),
          cleanup
        )
      })
    })
    return tempViewQueue.finish()
  }

  // persistent view
  const fullViewName = fun
  const parts = parseViewName(fullViewName)
  const designDocName = parts[0]
  const viewName = parts[1]
  return db.get("_design/" + designDocName).then(function (doc) {
    const fun = doc.views && doc.views[viewName]

    if (!fun || typeof fun.map !== "string") {
      throw new NotFoundError(
        "ddoc " + designDocName + " has no view named " + viewName
      )
    }
    checkQueryParseError(opts, fun)

    const createViewOpts = {
      db: db,
      viewName: fullViewName,
      map: fun.map,
      reduce: fun.reduce,
    }

    return createView(createViewOpts).then(onViewReady)
  })
}
