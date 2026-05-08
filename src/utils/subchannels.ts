import type { ChatTarget } from '../types';

export const SUBCHANNEL_SEPARATOR = ' ▸';
const PARENT_RE = / ▸\[parent:(\d+)\]\s*$/;

/** Strip the ` ▸[parent:ID]` marker and return the human-readable name. */
export function getCleanName(name: string): string {
  return name.replace(PARENT_RE, '').trim();
}

/** Return the encoded parent ID if present, otherwise null. */
export function getParentId(name: string): string | null {
  const m = name.match(PARENT_RE);
  return m ? m[1] : null;
}

/** Encode a subchannel name with the parent marker. */
export function encodeSubchannelName(displayName: string, parentId: string): string {
  return `${displayName.trim()}${SUBCHANNEL_SEPARATOR}[parent:${parentId}]`;
}

export interface ChannelNode extends ChatTarget {
  displayName: string;
  parentId: string | null;
  children: ChannelNode[];
}

/**
 * Build a one-level hierarchy from a flat channel list.
 * Channels whose parent ID is not found in the list are promoted to root.
 */
export function buildChannelTree(channels: ChatTarget[]): { roots: ChannelNode[]; orphans: ChannelNode[] } {
  const idSet = new Set(channels.map((ch) => ch.id));

  const nodes: ChannelNode[] = channels.map((ch) => ({
    ...ch,
    displayName: getCleanName(ch.name),
    parentId: getParentId(ch.name),
    children: [],
  }));

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const roots: ChannelNode[] = [];
  const orphans: ChannelNode[] = [];

  for (const node of nodes) {
    if (!node.parentId) {
      roots.push(node);
    } else if (idSet.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        orphans.push(node);
      }
    } else {
      // Parent referenced but not in list — treat as root (orphan)
      orphans.push(node);
    }
  }

  return { roots, orphans };
}
