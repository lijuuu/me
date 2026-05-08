---
title: how git works internally — objects, refs, and the dag
slug: git-internals-objects-refs-dag
date: May 8, 2026
description: the git object model, blobs, trees, commits, packfiles, and why git is just a content-addressable filesystem pretending to be a VCS.
---

git is not a version control system. it's a content-addressable filesystem with a VCS UI on top. every commit, every file, every directory is just an object in `~/.git/objects`, addressed by its SHA-1 hash. here is what's actually in there.

## the four object types

### blob
a blob is a file's content. no filename, no metadata — just bytes. `echo "hello" | git hash-object --stdin` produces `ce013625...`. this hash is the blob's name in the object store.

```
$ git cat-file -p ce013625030ba8dba906f756967f9e9ca394464a
hello
```

### tree
a tree is a directory listing. it maps names to objects (blobs or other trees), with permissions:

```
$ git cat-file -p HEAD^{tree}
100644 blob e69de29...  README.md
040000 tree a1b2c3d...  src
```

a tree is like a directory inode. it stores: mode, type, hash, name.

### commit
a commit points to a tree (the project root), a parent commit (or multiple for merges), an author, a committer, and a message:

```
$ git cat-file -p HEAD
tree 4b825dc...
parent a1b2c3d...
author liju <liju@example.com> 1715200000 +0530
committer liju <liju@example.com> 1715200000 +0530

fix: resolve race condition in worker pool
```

a branch is just a pointer to a commit. `refs/heads/main` is a file containing one SHA-1 hash. that's it.

### tag
an annotated tag is a commit-like object pointing to another object with a message. a lightweight tag is just a ref.

**reference**: [git internals — git objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)

## the content-addressable store

every object is stored at `.git/objects/XX/YYYY...` where `XX` is the first two hex chars of the SHA-1. the content is zlib-compressed.

```
.git/objects/
├── ce/
│   └── 013625030ba8dba906f756967f9e9ca394464a  # blob "hello"
├── 4b/
│   └── 825dc642cb6eb9a060e54bf8d69288fbee4904  # tree
└── a1/
    └── b2c3d4e5f6...                           # commit
```

this is why git is so fast at branch switching: the filesystem state at any commit is just the tree object + its descendants. no diffing, no patching — just unpack the tree.

## packfiles: how git saves space

storing every version of every file as a full blob would be huge. git periodically runs `git gc` which creates packfiles:

```
.git/objects/pack/
├── pack-abc123.pack  # compressed delta chains
└── pack-abc123.idx   # index for fast lookup
```

inside a packfile, git stores full objects plus deltas (diffs from the full object). the most recent version is stored in full; older versions are stored as reverse deltas. this is why `git log` for old commits is slower — git must reconstruct the old state from deltas.

**reference**: [git packfiles](https://git-scm.com/docs/pack-format)

## the DAG: why git branching is so cheap

commits form a directed acyclic graph (DAG):

```
  A -- B -- C (main)
       \
        D -- E (feature)
```

each commit points to its parent(s). a merge commit has two parents. this DAG is why `git merge-base` can find common ancestors in O(n) time. it's also why `git rebase` works: it replays commits as new commits with different parents, rewriting history.

the DAG is immutable — git never modifies existing objects, only creates new ones. this means branches are just labels on the graph. creating a branch costs 41 bytes (one file with one SHA). switching branches costs whatever it takes to update the working tree.

**reference**: [git branching model](https://nvie.com/posts/a-successful-git-branching-model/)

## the staging area (index)

between the working tree and the repository is the index. it's a binary file at `.git/index` that stores:

```
path, mode, sha1, flags, stage number
```

when you `git add`, git hashes the file, stores it as a blob, and updates the index. when you `git commit`, git creates a tree from the index and wraps it in a commit. the index is what makes partial staging (`git add -p`) possible.

**reference**: [git index format](https://git-scm.com/docs/index-format)

## the reflog: your safety net

`git reflog` shows where every branch HEAD has been:

```
$ git reflog
a1b2c3d HEAD@{0}: commit: fix race condition
d4e5f6a HEAD@{1}: reset: moving to HEAD~1
g7h8i9j HEAD@{2}: commit: add worker pool
```

even after `git reset --hard`, the old commits still exist in the object store. the reflog keeps references to them. after 90 days (default), unreferenced objects are garbage collected.

## why git won

| property | how git handles it |
|----------|-------------------|
| content integrity | SHA-1 hashes of content |
| branching | 41-byte files in `.git/refs` |
| merging | DAG traversal, 3-way merge |
| offline work | full copy of repo + history |
| speed | content-addressable store, no network for local ops |
| safety | immutable objects, reflog, garbage collection delay |

the secret: git is simple underneath. understanding the object model makes everything — rebase, cherry-pick, bisect, reflog — make sense.
