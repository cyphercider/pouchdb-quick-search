/*!
 * lunr.tokenizer
 * Copyright (C) @YEAR Oliver Nightingale
 */

/**
 * The sperator used to split a string into tokens. Override this property to change the behaviour of
 * `lunr.tokenizer` behaviour when tokenizing strings. By default this splits on whitespace and hyphens.
 *
 * @static
 * @see lunr.tokenizer
 */
const separator = /[\s\-]+/
import lunr from "lunr"

/**
 * A function for splitting a string into tokens ready to be inserted into
 * the search index. Uses `lunr.tokenizer.seperator` to split strings, change
 * the value of this property to change how strings are split into tokens.
 *
 * @module
 * @param {String} obj The string to convert into tokens
 * @see lunr.tokenizer.seperator
 * @returns {Array}
 */
export function tokenizer(obj) {
  this.load = function (label) {
    var fn = this.registeredFunctions[label]

    if (!fn) {
      throw new Error("Cannot load un-registered function: " + label)
    }

    return fn
  }

  this.label = "default"

  this.registeredFunctions = {
    default: lunr.tokenizer,
  }

  /**
   * Register a tokenizer function.
   *
   * Functions that are used as tokenizers should be registered if they are to be used with a serialised index.
   *
   * Registering a function does not add it to an index, functions must still be associated with a specific index for them to be used when indexing and searching documents.
   *
   * @param {Function} fn The function to register.
   * @param {String} label The label to register this function with
   * @memberOf tokenizer
   */
  this.registerFunction = function (fn, label) {
    if (label in this.registeredFunctions) {
      lunr.utils.warn("Overwriting existing tokenizer: " + label)
    }

    fn.label = label
    this.registeredFunctions[label] = fn
  }

  if (!arguments.length || obj == null || obj == undefined) return []
  if (Array.isArray(obj))
    return obj.map(function (t) {
      return lunr.utils.asString(t).toLowerCase()
    })

  return obj.toString().trim().toLowerCase().split(separator)
}
