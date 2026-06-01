declare module '@mapbox/polyline' {
  /**
   * Decode an encoded polyline string to an array of [lat, lng] pairs.
   */
  function decode(encoded: string, precision?: number): [number, number][]

  /**
   * Encode an array of [lat, lng] pairs to an encoded polyline string.
   */
  function encode(coordinates: [number, number][], precision?: number): string

  /**
   * Decode to GeoJSON.
   */
  function toGeoJSON(encoded: string, precision?: number): GeoJSON.LineString

  /**
   * Encode from GeoJSON.
   */
  function fromGeoJSON(geojson: GeoJSON.LineString | GeoJSON.Feature, precision?: number): string

  const _default: {
    decode: typeof decode
    encode: typeof encode
    toGeoJSON: typeof toGeoJSON
    fromGeoJSON: typeof fromGeoJSON
  }

  export default _default
  export { decode, encode, toGeoJSON, fromGeoJSON }
}
