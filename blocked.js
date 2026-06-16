// Magic Wand - blocked page. Send the user back where they came from.
document.getElementById("back").addEventListener("click", function () {
  // history.back() lands on the blocked site again; go two steps when possible.
  if (history.length > 2) {
    history.go(-2);
  } else {
    history.back();
  }
});
