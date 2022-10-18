"use strict"
export const docs4 = []
for (let i = 0; i < 20; i++) {
  docs4.push({
    _id: "yoshi_" + i,
    title: "This title is about Yoshi",
  })

  docs4.push({
    _id: "mario_" + i,
    title: "This title is about Mario",
  })

  // earlier ones are more strongly weighted
  for (let j = 0; j < 20 - i; j++) {
    docs4[docs4.length - 2].title += " Yoshi"
    docs4[docs4.length - 1].title += " Mario"
  }
}
