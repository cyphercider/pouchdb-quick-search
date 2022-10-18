export interface SearchOptions {
  /**
   * search string
   */
  query?: string
  /**
   * @deprecated - synonym for 'query' - use 'query' instead
   */
  q?: string
  /**
   * Fields to search
   */
  fields: string[] | Record<string, number>
  // "minimum should match" - [modeled after Solr's mm option](https://wiki.apache.org/solr/DisMaxQParserPlugin#mm_.28Minimum_.27Should.27_Match.29)
  mm?: string
  // Should return true for documents you want to index, and false for docs you want to skip
  filter?: (doc: any) => boolean
  highlighting?: any
  destroy?: any
  stale?: "ok" | "update_after"
  limit?: number
  build?: boolean
  skip?: number
  language?: any
  include_docs?: any
  // Verbose token output for better search (best for low-volume fields as storage demands can be high)
  high_resolution?: boolean
}

export interface QueryOpts {
  saveAs: string
  keys: string[]
  destroy: boolean
  stale: string
  limit: number
}
