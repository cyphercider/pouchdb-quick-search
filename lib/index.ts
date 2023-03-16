"use strict"
import stringify from "json-stable-stringify"
import lunr from "lunr"
import extend from "pouchdb-extend"
import uniq from "uniq"

import mapReduce from "./pouchdb-mapreduce-no-ddocs"
import { QueryOpts, SearchOptions } from "./types"

// Use a fork of pouchdb-mapreduce, which allows us
// deeper control over what's persisted, without needing ddocs

// const mapReduce = require("pouchdb-mapreduce-no-ddocs")

Object.keys(mapReduce).forEach(function (key) {
  exports[key] = mapReduce[key]
})

const utils = require("./pouch-utils")
const indexes = {}

const TYPE_TOKEN_COUNT = "a"
const TYPE_DOC_INFO = "b"

// get all the tokens found in the given text (non-unique)
// in the future, we might expand this to do more than just
// English. Also, this is a private Lunr API, hence why
// the Lunr version is pegged.
function getTokenStream(text: string, index: any, opts: SearchOptions) {
  let tokens: any[] = []
  if (opts.high_resolution === true) {
    const fragments = verboseTokenizer(text)
    tokens = fragments
  } else {
    tokens = lunr.tokenizer(text)
  }

  return tokens
}

/**
 * Produces exhaustive tokens of every word in a string, for high-resolution search
 */
function verboseTokenizer(text: string): string[] {
  const words = text.split(" ").filter((item) => !!item)
  const fragments: string[] = []

  for (const word of words) {
    const tokens = getExhaustiveTokensForWord(word)
    if (tokens.length > 0) fragments.push(...tokens)
  }

  return fragments
}

function isNumber(val: string) {
  return !isNaN(val as any)
}

function getExhaustiveTokensForWord(word: string): string[] {
  const tokens = [] as string[]

  if (isNumber(word)) {
    return [word]
  }

  if (word.length < 3) return []

  for (let i = 3; i <= word.length; i++) {
    tokens.push(word.slice(0, i).toLocaleLowerCase())
  }
  return tokens
}

// given an object containing the field name and/or
// a deepField definition plus the doc, return the text for
// indexing
function getText(fieldBoost, doc) {
  let text
  if (!fieldBoost.deepField) {
    text = doc[fieldBoost.field]
  } else {
    // "Enhance."
    text = doc
    for (let i = 0, len = fieldBoost.deepField.length; i < len; i++) {
      if (Array.isArray(text)) {
        text = text.map(
          handleNestedObjectArrayItem(fieldBoost, fieldBoost.deepField.slice(i))
        )
      } else {
        text = text && text[fieldBoost.deepField[i]]
      }
    }
  }
  if (text) {
    if (Array.isArray(text)) {
      text = text.join(" ")
    } else if (typeof text !== "string") {
      text = text.toString()
    }
  }
  return text
}

function handleNestedObjectArrayItem(fieldBoost, deepField) {
  return function (one) {
    return getText(
      extend({}, fieldBoost, {
        deepField: deepField,
      }),
      one
    )
  }
}

// map function that gets passed to map/reduce
// emits two types of key/values - one for each token
// and one for the field-len-norm
function createMapFunction(
  fieldBoosts,
  index,
  filter,
  db,
  opts: SearchOptions
) {
  return function (doc, emit) {
    if (isFiltered(doc, filter, db)) {
      return
    }

    const docInfo = []

    for (let i = 0, len = fieldBoosts.length; i < len; i++) {
      const fieldBoost = fieldBoosts[i]

      const text = getText(fieldBoost, doc)

      let fieldLenNorm
      if (text) {
        const terms = getTokenStream(text, index, opts)

        for (let j = 0, jLen = terms.length; j < jLen; j++) {
          const term = terms[j]
          // avoid emitting the value if there's only one field;
          // it takes up unnecessary space on disk

          // TODO - figure out why value is undefined here
          const value = fieldBoosts.length > 1 ? i : undefined
          emit(TYPE_TOKEN_COUNT + term, value)
        }
        fieldLenNorm = Math.sqrt(terms.length)
      } else {
        // no tokens
        fieldLenNorm = 0
      }
      docInfo.push(fieldLenNorm)
    }

    emit(TYPE_DOC_INFO + doc._id, docInfo)
  }
}

export interface SearchInterface {
  search: (opts: SearchOptions, callback?: any) => Promise<any>
}

export interface BulkDocsAny {
  bulkDocs: any
}

// Main search function
export const search = utils.toPromise(function (opts: SearchOptions, callback) {
  if (!opts.query) return []

  const pouch = this

  const { highlighting, include_docs, destroy, stale, limit, build } = opts

  opts = extend(true, {}, opts)
  const q = opts.query || opts.q
  const mm = "mm" in opts ? parseFloat(opts.mm) / 100 : 1 // e.g. '75%'
  let fields = opts.fields
  const skip = opts.skip || 0
  const language = opts.language || "en"
  const filter = opts.filter

  if (Array.isArray(fields)) {
    const fieldsMap = {}
    fields.forEach(function (field) {
      fieldsMap[field] = 1 // default boost
    })
    fields = fieldsMap
  }

  const fieldBoosts = Object.keys(fields).map(function (field) {
    const deepField = field.indexOf(".") !== -1 && field.split(".")
    return {
      field: field,
      deepField: deepField,
      boost: fields[field],
    }
  })

  let index = indexes[language]
  if (!index) {
    index = indexes[language] = lunr(() => {})

    if (Array.isArray(language)) {
      index.use(global.lunr["multiLanguage"].apply(this, language))
    } else if (language !== "en") {
      index.use(global.lunr[language])
    }
  }

  // the index we save as a separate database is uniquely identified
  // by the fields the user want to index (boost doesn't matter)
  // plus the tokenizer

  const indexParams = {
    language: language,
    fields: fieldBoosts
      .map(function (x) {
        return x.field
      })
      .sort(),
    filter: undefined,
  }

  if (filter) {
    indexParams.filter = filter.toString()
  }

  const persistedIndexName = "search-" + utils.MD5(stringify(indexParams))

  const mapFun = createMapFunction(fieldBoosts, index, filter, pouch, opts)

  const queryOpts: QueryOpts = {
    saveAs: persistedIndexName,
    destroy: undefined,
    limit: undefined,
    stale: undefined,
    keys: undefined,
  }
  if (destroy) {
    queryOpts.destroy = true
    return pouch._search_query(mapFun, queryOpts, callback)
  } else if (build) {
    delete queryOpts.stale // update immediately
    queryOpts.limit = 0
    pouch
      ._search_query(mapFun, queryOpts)
      .then(function () {
        callback(null, { ok: true })
      })
      .catch(callback)
    return
  }

  // it shouldn't matter if the user types the same
  // token more than once, in fact I think even Lucene does this
  // special cases like boingo boingo and mother mother are rare

  const queryTerms = uniq(getTokenStream(q, index, opts))

  if (!queryTerms.length) {
    return callback(null, { total_rows: 0, rows: [] })
  }
  queryOpts.keys = queryTerms.map(function (queryTerm) {
    return TYPE_TOKEN_COUNT + queryTerm
  })

  if (typeof stale === "string") {
    queryOpts.stale = stale
  }

  // search algorithm, basically classic TF-IDF
  //
  // step 1: get the doc+fields associated with the terms in the query
  // step 2: get the doc-len-norms of those document fields
  // step 3: calculate document scores using tf-idf
  //
  // note that we follow the Lucene convention (established in
  // DefaultSimilarity.java) of computing doc-len-norm (in our case, tecnically
  // field-lennorm) as Math.sqrt(numTerms),
  // which is an optimization that avoids having to look up every term
  // in that document and fully recompute its scores based on tf-idf
  // More info:
  // https://lucene.apache.org/core/3_6_0/api/core/org/apache/lucene/search/Similarity.html
  //

  // step 1
  pouch
    ._search_query(mapFun, queryOpts)
    .then(function (res) {
      if (!res.rows.length) {
        return callback(null, { total_rows: 0, rows: [] })
      }
      let total_rows = 0
      const docIdsToFieldsToQueryTerms = {}
      const termDFs = {}

      res.rows.forEach(function (row: any) {
        const term = row.key.substring(1)
        const field = row.value || 0

        // calculate termDFs
        if (!(term in termDFs)) {
          termDFs[term] = 1
        } else {
          termDFs[term]++
        }

        // calculate docIdsToFieldsToQueryTerms
        if (!(row.id in docIdsToFieldsToQueryTerms)) {
          const arr = (docIdsToFieldsToQueryTerms[row.id] = [])
          for (let i = 0; i < fieldBoosts.length; i++) {
            arr[i] = {}
          }
        }

        const docTerms = docIdsToFieldsToQueryTerms[row.id][field]
        if (!(term in docTerms)) {
          docTerms[term] = 1
        } else {
          docTerms[term]++
        }
      })

      // apply the minimum should match (mm)
      if (queryTerms.length > 1) {
        Object.keys(docIdsToFieldsToQueryTerms).forEach(function (docId) {
          const allMatchingTerms = {}
          const fieldsToQueryTerms = docIdsToFieldsToQueryTerms[docId]
          Object.keys(fieldsToQueryTerms).forEach(function (field) {
            Object.keys(fieldsToQueryTerms[field]).forEach(function (term) {
              allMatchingTerms[term] = true
            })
          })
          const numMatchingTerms = Object.keys(allMatchingTerms).length
          const matchingRatio = numMatchingTerms / queryTerms.length
          if (Math.floor(matchingRatio * 100) / 100 < mm) {
            delete docIdsToFieldsToQueryTerms[docId] // ignore this doc
          }
        })
      }

      if (!Object.keys(docIdsToFieldsToQueryTerms).length) {
        return callback(null, { total_rows: 0, rows: [] })
      }

      const keys = Object.keys(docIdsToFieldsToQueryTerms).map(function (
        docId
      ) {
        return TYPE_DOC_INFO + docId
      })

      const queryOpts = {
        saveAs: persistedIndexName,
        keys: keys,
        stale: stale,
      }

      // step 2
      return pouch
        ._search_query(mapFun, queryOpts)
        .then(function (res) {
          const docIdsToFieldsToNorms = {}
          res.rows.forEach(function (row) {
            docIdsToFieldsToNorms[row.id] = row.value
          })
          // step 3
          // now we have all information, so calculate scores
          const rows = calculateDocumentScores(
            queryTerms,
            termDFs,
            docIdsToFieldsToQueryTerms,
            docIdsToFieldsToNorms,
            fieldBoosts
          )
          return rows
        })
        .then(function (rows) {
          total_rows = rows.length
          // filter before fetching docs or applying highlighting
          // for a slight optimization, since for now we've only fetched ids/scores
          return typeof limit === "number" && limit >= 0
            ? rows.slice(skip, skip + limit)
            : skip > 0
            ? rows.slice(skip)
            : rows
        })
        .then(function (rows) {
          if (include_docs) {
            return applyIncludeDocs(pouch, rows)
          }
          return rows
        })
        .then(function (rows) {
          if (highlighting) {
            return applyHighlighting(
              pouch,
              opts,
              rows,
              fieldBoosts,
              docIdsToFieldsToQueryTerms
            )
          }
          return rows
        })
        .then(function (rows) {
          callback(null, { total_rows: total_rows, rows: rows })
        })
    })
    .catch(callback)
})

// returns a sorted list of scored results, like:
// [{id: {...}, score: 0.2}, {id: {...}, score: 0.1}];
//
// some background: normally this would be implemented as cosine similarity
// using tf-idf, which is equal to
// dot-product(q, d) / (norm(q) * norm(doc))
// (although there is no point in calculating the query norm,
// because all we care about is the relative score for a given query,
// so we ignore it, lucene does this too)
//
//
// but instead of straightforward cosine similarity, here I implement
// the dismax algorithm, so the doc score is the
// sum of its fields' scores, and this is done on a per-query-term basis,
// then the maximum score for each of the query terms is the one chosen,
// i.e. max(sumOfQueryTermScoresForField1, sumOfQueryTermScoresForField2, etc.)
//

function calculateDocumentScores(
  queryTerms,
  termDFs,
  docIdsToFieldsToQueryTerms,
  docIdsToFieldsToNorms,
  fieldBoosts
) {
  const results = Object.keys(docIdsToFieldsToQueryTerms).map(function (docId) {
    const fieldsToQueryTerms = docIdsToFieldsToQueryTerms[docId]
    const fieldsToNorms = docIdsToFieldsToNorms[docId]

    const queryScores = queryTerms.map(function (queryTerm) {
      return fieldsToQueryTerms
        .map(function (queryTermsToCounts, fieldIdx) {
          const fieldNorm = fieldsToNorms[fieldIdx]
          if (!(queryTerm in queryTermsToCounts)) {
            return 0
          }
          const termDF = termDFs[queryTerm]
          const termTF = queryTermsToCounts[queryTerm]
          const docScore = termTF / termDF // TF-IDF for doc
          const queryScore = 1 / termDF // TF-IDF for query, count assumed to be 1
          const boost = fieldBoosts[fieldIdx].boost
          return (docScore * queryScore * boost) / fieldNorm // see cosine sim equation
        })
        .reduce((a: number, b: number) => a + b, 0)
    })

    let maxQueryScore = -1
    queryScores.forEach(function (queryScore) {
      if (queryScore > maxQueryScore) {
        maxQueryScore = queryScore
      }
    })

    return {
      id: docId,
      score: maxQueryScore,
    }
  })

  results.sort(function (a, b) {
    return a.score < b.score ? 1 : a.score > b.score ? -1 : 0
  })

  return results
}

function applyIncludeDocs(pouch, rows) {
  return Promise.all(
    rows.map(function (row) {
      return pouch.get(row.id)
    })
  )
    .then(function (docs) {
      docs.forEach(function (doc, i) {
        rows[i].doc = doc
      })
    })
    .then(function () {
      return rows
    })
}

// create a convenient object showing highlighting results
// this is designed to be like solr's highlighting feature, so it
// should return something like
// {'fieldname': 'here is some <strong>highlighted text</strong>.'}
//
function applyHighlighting(
  pouch,
  opts,
  rows,
  fieldBoosts,
  docIdsToFieldsToQueryTerms
) {
  const pre = opts.highlighting_pre || "<strong>"
  const post = opts.highlighting_post || "</strong>"

  return Promise.all(
    rows.map(function (row) {
      return Promise.resolve()
        .then(function () {
          if (row.doc) {
            return row.doc
          }
          return pouch.get(row.id)
        })
        .then(function (doc) {
          row.highlighting = {}
          docIdsToFieldsToQueryTerms[row.id].forEach(function (queryTerms, i) {
            const fieldBoost = fieldBoosts[i]
            const fieldName = fieldBoost.field
            let text = getText(fieldBoost, doc)
            Object.keys(queryTerms).forEach(function (queryTerm) {
              const regex = new RegExp("(" + queryTerm + "[a-z]*)", "gi")
              const replacement = pre + "$1" + post
              text = text.replace(regex, replacement)
              row.highlighting[fieldName] = text
            })
          })
        })
    })
  ).then(function () {
    return rows
  })
}

// return true if filtered, false otherwise
// limit the try/catch to its own function to avoid deoptimization
function isFiltered(doc, filter, db) {
  try {
    return !!(filter && !filter(doc))
  } catch (e) {
    db.emit("error", e)
    return true
  }
}

/* istanbul ignore next */
if (typeof window !== "undefined" && window.PouchDB) {
  window.PouchDB.plugin(exports)
}
