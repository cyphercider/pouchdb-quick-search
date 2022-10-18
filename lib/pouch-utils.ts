"use strict"

/* istanbul ignore next */
export function once(fun) {
  let called = false
  return getArguments(function (args) {
    if (called) {
      console.trace()
      throw new Error("once called more than once")
    } else {
      called = true
      fun.apply(this, args)
    }
  })
}

/* istanbul ignore next */
function getArguments(fun) {
  return function () {
    const len = arguments.length
    const args = new Array(len)
    let i = -1
    while (++i < len) {
      args[i] = arguments[i]
    }
    return fun.call(this, args)
  }
}

export function toPromise(func) {
  //create the function we will be returning
  return getArguments(function (args) {
    const self = this
    const tempCB =
      typeof args[args.length - 1] === "function" ? args.pop() : false

    // if the last argument is a function, assume its a callback
    let usedCB

    if (tempCB) {
      // if it was a callback, create a new callback which calls it,
      // but do so async so we don't trap any errors
      usedCB = function (err, resp) {
        process.nextTick(function () {
          tempCB(err, resp)
        })
      }
    }

    const promise = new Promise<any>(function (fulfill, reject) {
      try {
        const callback = once(function (err, mesg) {
          if (err) {
            reject(err)
          } else {
            fulfill(mesg)
          }
        })
        // create a callback for this invocation
        // apply the function in the orig context
        args.push(callback)
        func.apply(self, args)
      } catch (e) {
        reject(e)
      }
    })

    // if there is a callback, call it back
    if (usedCB) {
      promise.then(function (result) {
        usedCB(null, result)
      }, usedCB)
    }

    ;(promise as any).cancel = function () {
      return this
    }
    return promise
  })
}

exports.Promise = Promise

const crypto = require("crypto")
const md5 = require("md5-jkmyers")

export function MD5(string) {
  if ((process as any).browser) {
    return md5(string)
  }
  return crypto.createHash("md5").update(string).digest("hex")
}

exports.extend = require("pouchdb-extend")
