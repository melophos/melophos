// runs before the page paints, so a saved choice of theme never flashes the other one.
// with no saved choice the page follows the system setting and nothing is set.
try {
  var saved = localStorage.getItem("melophos-theme");
  if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
} catch (e) {
  // storage can be blocked: the system setting then decides
}
