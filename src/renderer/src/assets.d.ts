declare module "*.png" {
  const url: string;
  export default url;
}

/** a script built on its own by Vite, for a worker or an audio worklet */
declare module "*?worker&url" {
  const url: string;
  export default url;
}
