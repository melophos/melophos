// the Studio's icon module imports each svg as text with "?raw". the site's build reads them the same way
declare module "*.svg?raw" {
  const markup: string;
  export default markup;
}
