import { addHttpParam, parseViewName, postprocessAttachments } from "./index"

export function httpQuery(db, fun, opts) {
  // List of parameters to add to the PUT request
  let params: string | string[] = []
  let body
  let method = "GET"

  // If opts.reduce exists and is defined, then add it to the list
  // of parameters.
  // If reduce=false then the results are that of only the map function
  // not the final result of map and reduce.
  addHttpParam("reduce", opts, params)
  addHttpParam("include_docs", opts, params)
  addHttpParam("attachments", opts, params)
  addHttpParam("limit", opts, params)
  addHttpParam("descending", opts, params)
  addHttpParam("group", opts, params)
  addHttpParam("group_level", opts, params)
  addHttpParam("skip", opts, params)
  addHttpParam("stale", opts, params)
  addHttpParam("conflicts", opts, params)
  addHttpParam("startkey", opts, params, true)
  addHttpParam("start_key", opts, params, true)
  addHttpParam("endkey", opts, params, true)
  addHttpParam("end_key", opts, params, true)
  addHttpParam("inclusive_end", opts, params)
  addHttpParam("key", opts, params, true)

  // Format the list of parameters into a valid URI query string
  params = params.join("&")
  params = params === "" ? "" : "?" + params

  // If keys are supplied, issue a POST to circumvent GET query string limits
  // see http://wiki.apache.org/couchdb/HTTP_view_API#Querying_Options
  if (typeof opts.keys !== "undefined") {
    const MAX_URL_LENGTH = 2000
    // according to http://stackoverflow.com/a/417184/680742,
    // the de facto URL length limit is 2000 characters
    const keysAsString = "keys=" + encodeURIComponent(JSON.stringify(opts.keys))
    if (keysAsString.length + params.length + 1 <= MAX_URL_LENGTH) {
      // If the keys are short enough, do a GET. we do this to work around
      // Safari not understanding 304s on POSTs (see pouchdb/pouchdb#1239)
      params += (params[0] === "?" ? "&" : "?") + keysAsString
    } else {
      method = "POST"
      if (typeof fun === "string") {
        body = { keys: opts.keys }
      } else {
        // fun is {map : mapfun}, so append to this
        fun.keys = opts.keys
      }
    }
  }

  // We are referencing a query defined in the design doc
  if (typeof fun === "string") {
    const parts = parseViewName(fun)
    return db
      .request({
        method: method,
        url: "_design/" + parts[0] + "/_view/" + parts[1] + params,
        body: body,
      })
      .then(postprocessAttachments(opts))
  }

  // We are using a temporary view, terrible for performance, good for testing
  body = body || {}
  Object.keys(fun).forEach(function (key) {
    if (Array.isArray(fun[key])) {
      body[key] = fun[key]
    } else {
      body[key] = fun[key].toString()
    }
  })
  return db
    .request({
      method: "POST",
      url: "_temp_view" + params,
      body: body,
    })
    .then(postprocessAttachments(opts))
}
