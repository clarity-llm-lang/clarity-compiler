# Merkle Tree (REQUIREMENTS)

**Status:** ⚠️ **BLOCKED** - Missing cryptographic hash functions, byte operations
**Complexity:** Advanced
**Category:** Blockchain, Cryptography, Data Structures

## Overview

Build a Merkle tree from data, generate proofs, and verify proofs. Demonstrates cryptographic hashing, binary tree structures, and proof systems.

## What is a Merkle Tree?

A binary tree where each non-leaf node is a hash of its children. Used in:
- Bitcoin/blockchain (verify transactions)
- Git (content-addressable storage)
- IPFS (distributed file systems)
- Certificate transparency

## Required Language Features

### 1. Cryptographic Hash Functions

```clarity
function sha256(data: String) -> String  // Returns hex string
function sha256_bytes(data: Bytes) -> Bytes  // Returns raw bytes

// Example:
let hash = sha256("hello");  // "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
```

### 2. Byte Array Operations

```clarity
type Bytes = List<Int64>  // or dedicated byte array type

function bytes_to_hex(b: Bytes) -> String
function hex_to_bytes(s: String) -> Bytes
function bytes_concat(a: Bytes, b: Bytes) -> Bytes
```

## Example Implementation

```clarity
type MerkleTree =
  | Leaf(hash: String)
  | Node(left: MerkleTree, right: MerkleTree, hash: String)

type MerkleProof = List<ProofStep>

type ProofStep =
  | LeftHash(hash: String)
  | RightHash(hash: String)

// Build Merkle tree from list of data
function build_merkle_tree(data: List<String>) -> MerkleTree {
  let leaves = map(data, hash_to_leaf);
  build_tree_level(leaves)
}

function hash_to_leaf(data: String) -> MerkleTree {
  Leaf(sha256(data))
}

// Recursively build tree from leaves upward
function build_tree_level(nodes: List<MerkleTree>) -> MerkleTree {
  match length(nodes) {
    1 -> head(nodes),  // Single root node
    _ -> build_tree_level(pair_and_hash(nodes))
  }
}

// Pair adjacent nodes and hash them together
function pair_and_hash(nodes: List<MerkleTree>) -> List<MerkleTree> {
  match length(nodes) <= 1 {
    True -> nodes,
    False -> {
      let left = head(nodes);
      let rest = tail(nodes);
      match length(rest) == 0 {
        True -> [left],  // Odd number, promote last node
        False -> {
          let right = head(rest);
          let remaining = tail(rest);
          let parent = create_parent(left, right);
          [parent] ++ pair_and_hash(remaining)
        }
      }
    }
  }
}

function create_parent(left: MerkleTree, right: MerkleTree) -> MerkleTree {
  let left_hash = get_hash(left);
  let right_hash = get_hash(right);
  let combined = left_hash ++ right_hash;
  let parent_hash = sha256(combined);
  Node(left, right, parent_hash)
}

function get_hash(tree: MerkleTree) -> String {
  match tree {
    Leaf(h) -> h,
    Node(_, _, h) -> h
  }
}

// Get root hash
function get_root_hash(tree: MerkleTree) -> String {
  get_hash(tree)
}

// Generate proof for a specific data element
function generate_proof(tree: MerkleTree, data: String) -> Option<MerkleProof> {
  let target_hash = sha256(data);
  generate_proof_helper(tree, target_hash, [])
}

function generate_proof_helper(tree: MerkleTree, target: String, path: MerkleProof) -> Option<MerkleProof> {
  match tree {
    Leaf(h) -> match string_eq(h, target) {
      True -> Some(reverse_list(path)),
      False -> None
    },
    Node(left, right, _) -> {
      // Try left subtree
      let left_hash = get_hash(left);
      let right_hash = get_hash(right);

      match generate_proof_helper(left, target, [RightHash(right_hash)] ++ path) {
        Some(proof) -> Some(proof),
        None -> generate_proof_helper(right, target, [LeftHash(left_hash)] ++ path)
      }
    }
  }
}

// Verify proof
function verify_proof(root_hash: String, data: String, proof: MerkleProof) -> Bool {
  let leaf_hash = sha256(data);
  let computed_root = apply_proof(leaf_hash, proof);
  string_eq(computed_root, root_hash)
}

function apply_proof(current_hash: String, proof: MerkleProof) -> String {
  match length(proof) == 0 {
    True -> current_hash,
    False -> {
      let step = head(proof);
      let rest = tail(proof);
      let next_hash = match step {
        LeftHash(h) -> sha256(h ++ current_hash),
        RightHash(h) -> sha256(current_hash ++ h)
      };
      apply_proof(next_hash, rest)
    }
  }
}

effect[Log] function demo() -> Unit {
  let data = ["tx1", "tx2", "tx3", "tx4"];

  let tree = build_merkle_tree(data);
  let root = get_root_hash(tree);

  print_string("Root hash: " ++ root);

  // Generate proof for "tx2"
  match generate_proof(tree, "tx2") {
    None -> print_string("Could not generate proof"),
    Some(proof) -> {
      print_string("Proof generated for tx2");

      // Verify proof
      let valid = verify_proof(root, "tx2", proof);
      match valid {
        True -> print_string("Proof verified!"),
        False -> print_string("Proof invalid!")
      }
    }
  }
}
```

## Learning Objectives

- Binary tree structures
- Cryptographic hashing
- Proof systems and verification
- Recursive tree traversal
- Blockchain fundamentals

## Dependencies

- ❌ `sha256` hash function (CRITICAL)
- ⚠️ Byte array operations (can work with hex strings)
- ⚠️ More hash functions (sha512, keccak, blake2) (NICE TO HAVE)
- ✅ Recursive union types (already supported)

## Related Examples

- `02-recursion` - Recursive data structures
- `20-expr-evaluator` - Tree traversal patterns

## Impact on Language Design

Cryptography is essential for:
- Blockchain applications
- Security protocols
- Data integrity verification
- Distributed systems

Clarity should provide:
- Common hash functions (SHA-256, SHA-512, BLAKE2, Keccak)
- HMAC for message authentication
- Digital signature verification
- Constant-time comparison (prevent timing attacks)
