/**
 * Generic message-tree helpers.
 *
 * Conversations are no longer linear: a message can have several replies that
 * share the same parent (a "branch"), produced by regenerating an assistant
 * response or editing a user message. These helpers turn a flat list of items
 * — each carrying an id, a parent id and an ordering key — into the single
 * linear "active path" that is shown to the user, plus the navigation metadata
 * for every point where the path forks.
 *
 * The helpers are deliberately generic (they know nothing about the app's
 * Message type) so the library can be reused wherever a parent-linked list
 * needs a branch view.
 */

/** Sentinel parent key for root-level items (items with no resolvable parent). */
export const ROOT_PARENT_KEY = '';

export interface MessageBranchInfo {
  /** 1-based position of the active item among its siblings. */
  index: number;
  /** Total number of siblings sharing this parent (including the active one). */
  count: number;
  /** Parent key the siblings share — pass to a branch selection to switch. */
  parentKey: string;
  /** Sibling ids in presentation (ascending order) order. */
  siblingIds: string[];
  /** Id to switch to for the previous branch, or undefined at the start. */
  previousId?: string;
  /** Id to switch to for the next branch, or undefined at the end. */
  nextId?: string;
}

export interface ActiveBranchResult<T> {
  /** The active linear path, root first. */
  path: T[];
  /**
   * Variant metadata keyed by item id, only for items that have siblings — the
   * data for an inline `‹ index / count ›` pager on a forked message.
   */
  branches: Map<string, MessageBranchInfo>;
  /**
   * Branch-point metadata keyed by item id: how many children a path item has,
   * present only when it has more than one — the data for a `⑂ N` tick on the
   * parent message that owns the fork.
   */
  branchPoints: Map<string, number>;
}

export interface MessageTreeAccessors<T> {
  /** Stable id of an item. Items without an id are ignored. */
  getId: (item: T) => string | undefined;
  /** Parent id of an item, or undefined/unknown for a root. */
  getParentId: (item: T) => string | undefined;
  /** Ordering key (e.g. created-at milliseconds); ascending = chronological. */
  getOrder: (item: T) => number;
}

export interface BranchSelectionOptions {
  /**
   * parentKey -> selected child id. When a parent's selection is missing or
   * points to an unknown child, the newest child (highest order) is used so a
   * freshly produced branch surfaces by default.
   */
  selections?: Readonly<Record<string, string>>;
}

const compareByOrderThenId = <T>(
  accessors: MessageTreeAccessors<T>,
): ((a: T, b: T) => number) => {
  return (a, b) => {
    const orderDelta = accessors.getOrder(a) - accessors.getOrder(b);
    if (orderDelta !== 0) {
      return orderDelta;
    }
    // Stable tie-break so equal timestamps produce a deterministic order.
    return (accessors.getId(a) ?? '').localeCompare(accessors.getId(b) ?? '');
  };
};

/**
 * Resolve the active linear path through a branching message list along with
 * the navigation metadata for each fork on that path.
 */
export const selectActiveBranch = <T>(
  items: readonly T[],
  accessors: MessageTreeAccessors<T>,
  options: BranchSelectionOptions = {},
): ActiveBranchResult<T> => {
  const selections = options.selections ?? {};

  const knownIds = new Set<string>();
  for (const item of items) {
    const id = accessors.getId(item);
    if (id !== undefined) {
      knownIds.add(id);
    }
  }

  // Group children by their resolved parent key. A parent id that is not part
  // of the supplied set is treated as a root so orphaned items still render.
  const childrenByParent = new Map<string, T[]>();
  for (const item of items) {
    const id = accessors.getId(item);
    if (id === undefined) {
      continue;
    }
    const parentId = accessors.getParentId(item);
    const parentKey =
      parentId !== undefined && knownIds.has(parentId) ? parentId : ROOT_PARENT_KEY;
    const group = childrenByParent.get(parentKey);
    if (group) {
      group.push(item);
    } else {
      childrenByParent.set(parentKey, [item]);
    }
  }

  const comparator = compareByOrderThenId(accessors);
  for (const group of childrenByParent.values()) {
    group.sort(comparator);
  }

  const path: T[] = [];
  const branches = new Map<string, MessageBranchInfo>();
  const branchPoints = new Map<string, number>();
  const visited = new Set<string>();

  let parentKey = ROOT_PARENT_KEY;
  for (;;) {
    const siblings = childrenByParent.get(parentKey);
    if (!siblings || siblings.length === 0) {
      break;
    }

    // The parent of this fork is a branch point. The virtual root has no
    // message to annotate, so it is skipped.
    if (siblings.length > 1 && parentKey !== ROOT_PARENT_KEY) {
      branchPoints.set(parentKey, siblings.length);
    }

    const siblingIds = siblings.map((item) => accessors.getId(item) as string);
    const selectedId = selections[parentKey];
    let activeIndex = selectedId ? siblingIds.indexOf(selectedId) : -1;
    if (activeIndex < 0) {
      // Default to the newest sibling.
      activeIndex = siblings.length - 1;
    }

    const active = siblings[activeIndex];
    const activeId = siblingIds[activeIndex];

    // Guard against pathological cycles (a parent that is also a descendant).
    if (visited.has(activeId)) {
      break;
    }
    visited.add(activeId);

    path.push(active);

    if (siblings.length > 1) {
      branches.set(activeId, {
        index: activeIndex + 1,
        count: siblings.length,
        parentKey,
        siblingIds,
        previousId: activeIndex > 0 ? siblingIds[activeIndex - 1] : undefined,
        nextId:
          activeIndex < siblings.length - 1 ? siblingIds[activeIndex + 1] : undefined,
      });
    }

    parentKey = activeId;
  }

  return { path, branches, branchPoints };
};
