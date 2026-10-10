/** Candidate leaf shapes shared by the Query Dataset readers. */
export interface TagCandidateLeaf {
  readonly kind: "tag";
  readonly value: string;
}

export interface KeysCandidateLeaf {
  readonly kind: "keys";
  readonly keys: readonly string[];
}

export interface ParentCandidateLeaf<Leaf> {
  readonly kind: "parent";
  readonly leaf: Leaf;
}
