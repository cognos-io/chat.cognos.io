import { describe, expect, it } from 'vitest';

import {
  MessageTreeAccessors,
  ROOT_PARENT_KEY,
  selectActiveBranch,
} from './message-tree';

interface Node {
  id: string;
  parentId?: string;
  order: number;
}

const accessors: MessageTreeAccessors<Node> = {
  getId: (n) => n.id,
  getParentId: (n) => n.parentId,
  getOrder: (n) => n.order,
};

const ids = (nodes: Node[]) => nodes.map((n) => n.id);

describe('selectActiveBranch', () => {
  it('returns a linear conversation in order with no branches', () => {
    const nodes: Node[] = [
      { id: 'u1', order: 1 },
      { id: 'a1', parentId: 'u1', order: 2 },
      { id: 'u2', parentId: 'a1', order: 3 },
      { id: 'a2', parentId: 'u2', order: 4 },
    ];

    const result = selectActiveBranch(nodes, accessors);

    expect(ids(result.path)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(result.branches.size).toBe(0);
  });

  it('defaults to the newest sibling at a fork', () => {
    const nodes: Node[] = [
      { id: 'u1', order: 1 },
      { id: 'a1', parentId: 'u1', order: 2 },
      // a regenerated, newer reply to the same user message
      { id: 'a2', parentId: 'u1', order: 3 },
    ];

    const result = selectActiveBranch(nodes, accessors);

    expect(ids(result.path)).toEqual(['u1', 'a2']);
    const branch = result.branches.get('a2');
    expect(branch).toMatchObject({
      index: 2,
      count: 2,
      parentKey: 'u1',
      previousId: 'a1',
      nextId: undefined,
    });
    // u1 is the branch point that owns the fork (2 children).
    expect(result.branchPoints.get('u1')).toBe(2);
    expect(result.branchPoints.has('a2')).toBe(false);
  });

  it('follows an explicit selection and exposes prev/next navigation', () => {
    const nodes: Node[] = [
      { id: 'u1', order: 1 },
      { id: 'a1', parentId: 'u1', order: 2 },
      { id: 'a2', parentId: 'u1', order: 3 },
      { id: 'a3', parentId: 'u1', order: 4 },
      // children only exist under a1 to prove selection drives descendants
      { id: 'u2', parentId: 'a1', order: 5 },
      { id: 'a4', parentId: 'u2', order: 6 },
    ];

    const result = selectActiveBranch(nodes, accessors, {
      selections: { u1: 'a1' },
    });

    expect(ids(result.path)).toEqual(['u1', 'a1', 'u2', 'a4']);
    const branch = result.branches.get('a1');
    expect(branch).toMatchObject({
      index: 1,
      count: 3,
      parentKey: 'u1',
      siblingIds: ['a1', 'a2', 'a3'],
      previousId: undefined,
      nextId: 'a2',
    });
  });

  it('falls back to newest when a selection points at an unknown child', () => {
    const nodes: Node[] = [
      { id: 'u1', order: 1 },
      { id: 'a1', parentId: 'u1', order: 2 },
      { id: 'a2', parentId: 'u1', order: 3 },
    ];

    const result = selectActiveBranch(nodes, accessors, {
      selections: { u1: 'does-not-exist' },
    });

    expect(ids(result.path)).toEqual(['u1', 'a2']);
  });

  it('orders sibling roots and treats orphans as roots', () => {
    const nodes: Node[] = [
      // two root user messages (e.g. an edited first message)
      { id: 'r2', order: 2 },
      { id: 'r1', order: 1 },
      // parent id references a message that is not present -> treated as root
      { id: 'orphan', parentId: 'missing', order: 3 },
    ];

    const result = selectActiveBranch(nodes, accessors);

    // newest root wins by default
    expect(result.path[0]?.id).toBe('orphan');
    const branch = result.branches.get('orphan');
    expect(branch).toMatchObject({
      count: 3,
      parentKey: ROOT_PARENT_KEY,
      siblingIds: ['r1', 'r2', 'orphan'],
    });
    // The virtual root is not a real message, so it is never a branch point.
    expect(result.branchPoints.size).toBe(0);
  });

  it('ignores items without an id', () => {
    const nodes: Node[] = [
      { id: undefined as unknown as string, order: 0 },
      { id: 'u1', order: 1 },
      { id: 'a1', parentId: 'u1', order: 2 },
    ];

    const result = selectActiveBranch(nodes, accessors);
    expect(ids(result.path)).toEqual(['u1', 'a1']);
  });

  it('terminates on a parent cycle instead of looping forever', () => {
    const nodes: Node[] = [
      { id: 'x', parentId: 'y', order: 1 },
      { id: 'y', parentId: 'x', order: 2 },
    ];

    // Neither node is a root (each parents the other), so nothing renders —
    // but crucially the walk terminates.
    const result = selectActiveBranch(nodes, accessors);
    expect(result.path).toEqual([]);
  });
});
