import {
  LibraryScopeStub,
  MY_LIBRARY_ID,
  GROUP_LIBRARY_ID,
  KEY_A,
  personalLibrary,
  groupLibrary,
} from "@/services/citation-index/test-harness";
/** An Indexed Key of the group Library the multi-Library fixtures use. */
export const GROUP_KEY = "GRP12345g7";
/** An Indexed Key of My Library, for a second Item there. */
export const TWIN_KEY = "RVW23456";

export const myLibraryRow = {
  itemID: 1,
  libraryID: MY_LIBRARY_ID,
  key: KEY_A,
  indexedKey: KEY_A,
  citekey: "doe2024",
};
/** A second Item of My Library answering to the same citekey. */
export const sameLibraryTwin = {
  itemID: 2,
  libraryID: MY_LIBRARY_ID,
  key: TWIN_KEY,
  indexedKey: TWIN_KEY,
  citekey: "doe2024",
};
/** An Item of the group Library answering to the same citekey. A lower
 *  `itemID` than its My Library twin, so Library order alone can order them. */
export const groupTwin = {
  itemID: 1,
  libraryID: GROUP_LIBRARY_ID,
  key: "GRP12345",
  indexedKey: GROUP_KEY,
  citekey: "doe2024",
};

export function bothLibraries(): LibraryScopeStub {
  return new LibraryScopeStub([personalLibrary(), groupLibrary()]);
}
