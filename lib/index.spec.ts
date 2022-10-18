import Pouch from "pouchdb"

// const Pouch = require("pouchdb-memory")
import uniq from "uniq"
import { BulkDocsAny, SearchInterface } from "."
import { docs } from "../test/docs/test-docs"
import { docs2 } from "../test/docs/test-docs-2"
import { docs3 } from "../test/docs/test-docs-3"
import { docs4 } from "../test/docs/test-docs-4"
import { docs5 } from "../test/docs/test-docs-5"
import { docs6 } from "../test/docs/test-docs-6"
import { docs8 } from "../test/docs/test-docs-8"
import { docs9 } from "../test/docs/test-docs-9"
import _ from "lodash"

//
// your plugin goes here
//
const helloPlugin = require(".")
Pouch.plugin(helloPlugin)
Pouch.plugin(require("pouchdb-adapter-memory"))

const dbType = "memory"
const dbName = "dbname"

jest.setTimeout(30000)

describe("search test suite", () => {
  let db: SearchInterface & PouchDB.Database<{}> & BulkDocsAny

  beforeEach(function () {
    db = new Pouch(dbName) as any
  })

  afterEach(function () {
    return db.destroy()
  })

  it("basic search default", function () {
    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "sketch",
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(1)
        expect(res.rows[0].id).toBe("3")
        expect(_.round(res.rows[0].score, 4)).toBe(0.0945)
      })
  })

  it("basic search - zero results", function () {
    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "fizzbuzz",
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(0)
      })
  })

  it("basic search - equal scores", function () {
    return db
      .bulkDocs({ docs: docs2 })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "text",
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(2)
        expect(res.rows[0].score).toBe(res.rows[1].score)
      })
  })

  it("basic search - ordering", function () {
    // the word "court" is used once in the first doc,
    // twice in the second, and twice in the third,
    // but the third is longest, so tf-idf should give us
    // 2 3 1

    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "court",
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(3)
        const ids = res.rows.map(function (x) {
          return x.id
        })

        // "got incorrect doc order: " + JSON.stringify(res)
        expect(ids).toEqual(["2", "3", "1"])
      })
  })

  it("search with mm=100% and 1/2 match", function () {
    // if mm (minimum should match) is 100%, that means all terms in the
    // query must be present in the document. I find this most intuitive,
    // so it's the default

    // docs 1 and 2 both contain the word 'title', but only 1 contains
    // both of the words 'title' and 'clouded'

    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "clouded title",
          mm: "100%",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1"])
      })
  })

  it("search with mm=50% and 2/2 match", function () {
    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "clouded title",
          mm: "50%",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1", "2"])
      })
  })

  it("search with mm=1% and 1/3 match", function () {
    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "clouded nonsenseword anothernonsenseword",
          mm: "1%",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1"])
      })
  })

  it("search with mm=34% and 1/3 match", function () {
    // should be rounded down to two decimal places ala Solr
    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "clouded nonsenseword anothernonsenseword",
          mm: "34%",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual([])
      })
  })
  it("search with mm=34% and 2/3 match", function () {
    // should be rounded down to two decimal places ala Solr
    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "clouded title anothernonsenseword",
          mm: "34%",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1"])
      })
  })
  it("search with mm=33% and 1/3 match", function () {
    // should be rounded down to two decimal places ala Solr
    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "clouded nonsenseword anothernonsenseword",
          mm: "33%",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1"])
      })
  })

  it("should weight short fields more strongly", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "yoshi",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1", "2"])

        // Score should be higher
        expect(res.rows[0].score).not.toBe(res.rows[1].score)
      })
  })

  it("should weight short fields more strongly part 2", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "mario",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["2", "1"])
        // Score should be higher
        expect(res.rows[0].score).not.toEqual(res.rows[1].score)
      })
  })

  it("should use dismax weighting", function () {
    // see http://lucene.apache.org/core/3_0_3/api/core/org/apache/
    //     lucene/search/DisjunctionMaxQuery.html
    // for why this example makes sense

    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "albino elephant",
          mm: "50%",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["3", "4"])

        // Score should be higher
        expect(res.rows[0].score).not.toEqual(res.rows[1].score)
      })
  })

  it("should work with one field only", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: ["text"],
          query: "mario",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual(["1"])
      })
  })

  it("should be able to delete", function () {
    const opts = {
      fields: ["text"],
      query: "mario",
      destroy: undefined,
      stale: undefined,
    }
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        // "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1"])
        opts.destroy = true
        delete opts.query
        return db.search(opts)
      })
      .then(function () {
        opts.stale = "ok"
        opts.destroy = false
        opts.query = "mario"
        return db.search(opts)
      })
      .then(function (res) {
        // "expect no search results for stale=ok"
        expect(res.rows.length).toBe(0)
      })
  })

  it("gives zero results when stale", function () {
    const opts = {
      fields: ["text", "title"],
      query: "mario",
      stale: "ok",
    }
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        return db.search(opts)
      })
      .then(function (res) {
        // "no results after stale=ok"
        expect(res.rows.length).toBe(0)
        opts.stale = "update_after"
        return db.search(opts)
      })
      .then(function (res) {
        //           "no results after stale=update_after"
        expect(res.rows.length).toBeGreaterThanOrEqual(0)
        expect(res.rows.length).toBeLessThanOrEqual(2)

        delete opts.stale
        return db.search(opts)
      })
      .then(function (res) {
        // "got results eventually"
        expect(res.rows.length).toBe(2)
      })
  })

  it("can explicitly build an index", function () {
    const opts = {
      fields: ["text", "title"],
      build: true,
      query: undefined,
      stale: undefined,
    }
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        return db.search(opts)
      })
      .then(function (info) {
        expect(info).toEqual({ ok: true })
        delete opts.build
        opts.query = "mario"
        opts.stale = "ok"
        return db.search(opts)
      })
      .then(function (res) {
        // "got results after building"
        expect(res.rows.length).toBe(2)
      })
  })

  it("uniquely IDs same fields with different order", function () {
    let opts = {
      fields: ["text", "title"],
      query: "mario",
      stale: undefined,
    }
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["2", "1"])
        opts = {
          fields: ["title", "text"],
          query: "mario",
          stale: "ok",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["2", "1"])
      })
  })

  it("should work with pure stopwords", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: ["text"],
          query: "to be or not to be",
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(0)
      })
  })

  it("allows you to weight fields", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: { text: 10, title: 1 },
          query: "mario",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1", "2"])
        expect(res.rows[0].score).not.toEqual(res.rows[1].score)
      })
  })

  it("allows you to weight fields part 2", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: { text: 10, title: 1 },
          query: "yoshi",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["2", "1"])
        expect(res.rows[0].score).not.toEqual(res.rows[1].score)
      })
  })

  it("allows you to highlight", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: { text: 1, title: 1 },
          query: "yoshi",
          highlighting: true,
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1", "2"])
        expect(res.rows[0].score).not.toEqual(res.rows[1].score)
        const hls = res.rows.map(function (x) {
          return x.highlighting
        })
        expect(hls).toEqual([
          { title: "This title is about <strong>Yoshi</strong>" },
          {
            text:
              "This text is about <strong>Yoshi</strong>, but it's " +
              "much longer, so it shouldn't be weighted so much.",
          },
        ])
      })
  })
  it("allows you to highlight with custom tags", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: { text: 1, title: 1 },
          query: "yoshi",
          highlighting: true,
          highlighting_pre: "<em>",
          highlighting_post: "</em>",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1", "2"])
        expect(res.rows[0].score).not.toEqual(res.rows[1].score)
        const hls = res.rows.map(function (x) {
          return x.highlighting
        })
        expect(hls).toEqual([
          { title: "This title is about <em>Yoshi</em>" },
          {
            text:
              "This text is about <em>Yoshi</em>, but it's " +
              "much longer, so it shouldn't be weighted so much.",
          },
        ])
      })
  })
  it("supports include_docs", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: { text: 1, title: 1 },
          q: "yoshi",
          include_docs: true,
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1", "2"])
        const docs = res.rows.map(function (x) {
          return {
            _id: x.doc._id,
            text: x.doc.text,
            title: x.doc.title,
          }
        })
        expect(docs).toEqual(docs3.slice(0, 2))
      })
  })
  it("doesn't highlight or include docs by default", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: { text: 1, title: 1 },
          q: "yoshi",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1", "2"])
        expect(ids[0].doc).toBeUndefined()
        expect(ids[0].highlighting).toBeUndefined()
      })
  })
  it("can highlight and include docs at the same time", function () {
    return db
      .bulkDocs({ docs: docs3 })
      .then(function () {
        const opts = {
          fields: { text: 1, title: 1 },
          query: "yoshi",
          highlighting: true,
          include_docs: true,
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        //           "got incorrect docs: " + JSON.stringify(res)
        expect(ids).toEqual(["1", "2"])
        expect(res.rows[0].score).not.toEqual(res.rows[1].score)
        const hls = res.rows.map(function (x) {
          return x.highlighting
        })
        expect(hls).toEqual([
          { title: "This title is about <strong>Yoshi</strong>" },
          {
            text:
              "This text is about <strong>Yoshi</strong>, but it's " +
              "much longer, so it shouldn't be weighted so much.",
          },
        ])
        const docs = res.rows.map(function (x) {
          return {
            _id: x.doc._id,
            text: x.doc.text,
            title: x.doc.title,
          }
        })
        expect(docs).toEqual(docs3.slice(0, 2))
      })
  })

  it("supports limit", function () {
    return db
      .bulkDocs({ docs: docs4 })
      .then(function () {
        const opts = {
          fields: ["text", "title"],
          query: "yoshi",
          limit: 5,
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(5)
        expect(
          uniq(
            res.rows.map(function (x) {
              return x.score
            })
          ).length
        ).toBe(5)
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual([
          "yoshi_0",
          "yoshi_1",
          "yoshi_2",
          "yoshi_3",
          "yoshi_4",
        ])
      })
  })

  it("supports skip", function () {
    return db
      .bulkDocs({ docs: docs4 })
      .then(function () {
        const opts = {
          fields: ["text", "title"],
          query: "yoshi",
          skip: 15,
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(5)
        expect(
          uniq(
            res.rows.map(function (x) {
              return x.score
            })
          ).length
        ).toBe(5)
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual([
          "yoshi_15",
          "yoshi_16",
          "yoshi_17",
          "yoshi_18",
          "yoshi_19",
        ])
      })
  })

  it("supports limit and skip", function () {
    return db
      .bulkDocs({ docs: docs4 })
      .then(function () {
        const opts = {
          fields: ["text", "title"],
          query: "yoshi",
          skip: 10,
          limit: 5,
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(5)
        expect(
          uniq(
            res.rows.map(function (x) {
              return x.score
            })
          ).length
        ).toBe(5)
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual([
          "yoshi_10",
          "yoshi_11",
          "yoshi_12",
          "yoshi_13",
          "yoshi_14",
        ])
      })
  })

  it("allows searching deep fields", function () {
    return db
      .bulkDocs({ docs: docs5 })
      .then(function () {
        const opts = {
          fields: ["deep.structure.text"],
          query: "squirrels",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual(["2"])
      })
  })
  it("allows searching from an array of nested objects", function () {
    return db
      .bulkDocs({ docs: docs9 })
      .then(function () {
        const opts = {
          fields: ["nested.array.aField"],
          query: "something",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows
          .map(function (x) {
            return x.id
          })
          .sort()
          .reverse()
        expect(ids).toEqual(["2", "10"])
      })
  })
  it("allows searching string arrays", function () {
    return db
      .bulkDocs({ docs: docs5 })
      .then(function () {
        const opts = {
          fields: ["list"],
          query: "array",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual(["1"])
      })
  })
  it("does nothing when the field is invalid", function () {
    return db
      .bulkDocs({ docs: docs5 })
      .then(function () {
        const opts = {
          fields: ["invalid"],
          query: "foo",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual([])
      })
  })
  it("can use numbers as field values", function () {
    return db
      .bulkDocs({ docs: docs5 })
      .then(function () {
        const opts = {
          fields: ["aNumber"],
          query: "1",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual(["3"])
      })
  })
  it("weights higher when words are mentioned more than once", function () {
    return db
      .bulkDocs({ docs: docs6 })
      .then(function () {
        const opts = {
          fields: ["text"],
          query: "word",
        }
        return db.search(opts)
      })
      .then(function (res) {
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual(["1", "2"])
        expect(res.rows[0].score).not.toEqual(res.rows[1].score)
      })
  })

  it("search with filter", function () {
    // the word "court" is used in all 3 docs
    // but we filter out the doc._id === "2"

    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "court",
          filter: function (doc) {
            return doc._id !== "2"
          },
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(2)
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual(["3", "1"])
      })
  })

  it("search with filter - Error thrown ", function () {
    //the filter function will throw an Error for
    //one doc, which filter it out.

    let error

    //filter function throw an error ?
    db.on("error", function (err) {
      error = err
    })

    return db
      .bulkDocs({ docs: docs })
      .then(function () {
        const opts = {
          fields: ["title", "text", "desc"],
          query: "court",
          filter: function (doc) {
            if (doc._id === "1") {
              throw new Error("oups")
            }
            return true
          },
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.rows.length).toBe(2)
        const ids = res.rows.map(function (x) {
          return x.id
        })
        expect(ids).toEqual(["2", "3"])
        expect(error.message).toEqual("oups")
        // error.should.have.property("message", "oups")
      })
  })

  it("total_rows default", function () {
    return db
      .bulkDocs({ docs: docs8 })
      .then(function () {
        const opts = {
          fields: ["category"],
          query: "PL",
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.total_rows).toBe(3)
      })
  })

  it("total_rows with filter and limit", function () {
    return db
      .bulkDocs({ docs: docs8 })
      .then(function () {
        const opts = {
          fields: ["category"],
          query: "PL",
          filter: function (doc) {
            return doc.type !== "static"
          },
        }
        return db.search(opts)
      })
      .then(function (res) {
        expect(res.total_rows).toBe(2)
      })
  })
})
