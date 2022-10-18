"use strict"
const doc1 = {
  _id: "1",
  title: "This title is about Yoshi",
  text: "This text is about Mario but it's much longer, so it shouldn't be weighted so much.",
}
const doc2 = {
  _id: "2",
  title: "This title is about Mario",
  text: "This text is about Yoshi, but it's much longer, so it shouldn't be weighted so much.",
}
const doc3 = {
  _id: "3",
  title: "this is about an albino",
  text: "and this is about an elephant",
}
const doc4 = {
  _id: "4",
  title: "this is about an albino",
  text: "and this is about an albino",
}

export const docs3 = [doc1, doc2, doc3, doc4]
