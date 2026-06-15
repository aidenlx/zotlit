import {
  type AnnotItem,
  type AtchItem,
  type DocItem,
  type TagItem,
} from "./store";

// Adapted from v1's `lib/components/src/mock/data.json` (El-Brolosy & Stainier
// 2017). A second, empty attachment is added so the attachment selector renders.

const PARENT_KEY = "QSGICCGF";

export const mockDoc: DocItem = {
  itemID: 23218,
  title: "Genetic compensation: A phenomenon in search of mechanisms",
};

export const mockAttachments: AtchItem[] = [
  {
    itemID: 23220,
    key: PARENT_KEY,
    path: "storage:El-Brolosy and Stainier - 2017 - Genetic compensation.pdf",
    annotCount: 6,
  },
  {
    itemID: 23221,
    key: "ABCD1234",
    path: "storage:Supplementary material.pdf",
    annotCount: 0,
  },
];

export const mockAnnotations: AnnotItem[] = [
  {
    itemID: 23228,
    key: "45T7RMUW",
    type: 1, // highlight
    text: "Genetic robustness is the ability of a living organism to maintain its viability and fitness despite genetic variations, including perturbations.",
    comment: null,
    color: "#2ea8e5",
    pageLabel: "1",
    parentKey: PARENT_KEY,
  },
  {
    itemID: 23229,
    key: "WW9NBMR9",
    type: 1, // highlight
    text: "Genetic robustness may arise from redundant genes,",
    comment: "Key definition — cite in the introduction.",
    color: "#2ea8e5",
    pageLabel: "1",
    parentKey: PARENT_KEY,
  },
  {
    itemID: 23233,
    key: "PRIGA3CK",
    type: 5, // underline
    text: "triggered upstream of protein function (hereafter referred to as genetic compensation or transcriptional adaptation",
    comment: null,
    color: "#5fb236",
    pageLabel: "2",
    parentKey: PARENT_KEY,
  },
  {
    itemID: 23271,
    key: "HELTDEPQ",
    type: 3, // image
    text: null,
    comment: null,
    color: "#ffd400",
    pageLabel: "3",
    parentKey: PARENT_KEY,
  },
  {
    itemID: 23244,
    key: "M6ZXKU8J",
    type: 6, // free text
    text: "A note typed directly in the Zotero reader.",
    comment: "Comments render below the excerpt.",
    color: "#a28ae5",
    pageLabel: "3",
    parentKey: PARENT_KEY,
  },
  {
    itemID: 23261,
    key: "LBYMJAPX",
    type: 1, // highlight
    text: "Upregulation of related genes due to the loss of a negative feedback loop",
    comment: null,
    color: "#ff6666",
    pageLabel: "2",
    parentKey: PARENT_KEY,
  },
];

export const mockTags: Record<number, TagItem[]> = {
  23229: [
    { tagID: 1, name: "definition" },
    { tagID: 2, name: "to-read" },
  ],
  23244: [{ tagID: 3, name: "methods" }],
};
