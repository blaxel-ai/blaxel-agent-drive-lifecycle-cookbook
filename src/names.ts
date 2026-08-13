const MAX_RESOURCE_NAME_LENGTH = 49;

function hash(value: string): string {
  let current = 0x811c9dc5;

  for (const character of value) {
    current ^= character.charCodeAt(0);
    current = Math.imul(current, 0x01000193);
  }

  return (current >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

function slug(value: string): string {
  let normalized = "";
  let separatorPending = false;

  for (const character of value.toLowerCase()) {
    const code = character.charCodeAt(0);
    const allowed = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);

    if (allowed) {
      if (separatorPending && normalized.length > 0) normalized += "-";
      normalized += character;
      separatorPending = false;
    } else if (normalized.length > 0) {
      separatorPending = true;
    }
  }

  return normalized || "resource";
}

function resourceName(prefix: string, value: string): string {
  const suffix = hash(value);
  const available =
    MAX_RESOURCE_NAME_LENGTH - prefix.length - suffix.length - 2;
  let readable = slug(value).slice(0, Math.max(1, available));
  while (readable.endsWith("-")) readable = readable.slice(0, -1);

  return `${prefix}-${readable}-${suffix}`;
}

export function driveNameForAgent(agentId: string): string {
  return resourceName("agent-drive", agentId);
}

export function sandboxNameForInvocation(
  agentId: string,
  invocationId: string,
): string {
  return resourceName("agent-msg", `${agentId}-${invocationId}`);
}
