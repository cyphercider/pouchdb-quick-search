import { collate } from "pouchdb-collate"
import evalFunc from "./evalfunc"
import {
  builtInReduce,
  sum,
  log,
  tryCode,
  BuiltInError,
  sliceResults,
} from "./index"

export function reduceView(view, results, options) {
  if (options.group_level === 0) {
    delete options.group_level
  }

  const shouldGroup = options.group || options.group_level

  let reduceFun
  if (builtInReduce[view.reduceFun]) {
    reduceFun = builtInReduce[view.reduceFun]
  } else {
    reduceFun = evalFunc(
      view.reduceFun.toString(),
      null,
      sum,
      log,
      Array.isArray,
      JSON.parse
    )
  }

  const groups = []
  const lvl = isNaN(options.group_level)
    ? Number.POSITIVE_INFINITY
    : options.group_level
  results.forEach(function (e) {
    const last = groups[groups.length - 1]
    let groupKey = shouldGroup ? e.key : null

    // only set group_level for array keys
    if (shouldGroup && Array.isArray(groupKey)) {
      groupKey = groupKey.slice(0, lvl)
    }

    if (last && collate(last.groupKey, groupKey) === 0) {
      last.keys.push([e.key, e.id])
      last.values.push(e.value)
      return
    }
    groups.push({
      keys: [[e.key, e.id]],
      values: [e.value],
      groupKey: groupKey,
    })
  })
  results = []
  for (let i = 0, len = groups.length; i < len; i++) {
    const e = groups[i]
    const reduceTry = tryCode(view.sourceDB, reduceFun, [
      e.keys,
      e.values,
      false,
    ])
    if (reduceTry.error && reduceTry.error instanceof BuiltInError) {
      // CouchDB returns an error if a built-in errors out
      throw reduceTry.error
    }
    results.push({
      // CouchDB just sets the value to null if a non-built-in errors out
      value: reduceTry.error ? null : reduceTry.output,
      key: e.groupKey,
    })
  }
  // no total_rows/offset when reducing
  return { rows: sliceResults(results, options.limit, options.skip) }
}
