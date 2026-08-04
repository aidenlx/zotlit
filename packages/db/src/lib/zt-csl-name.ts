// Normalize structured Zotero creator names for CSL processors.
import { regex } from "arkregex";

/** A structured personal-name entry in CSL-JSON. */
export interface CslPersonName {
  family: string;
  given: string;
  "non-dropping-particle"?: string;
  "dropping-particle"?: string;
  suffix?: string;
  "comma-suffix"?: true;
  "comma-dropping-particle"?: ",";
}

const PARTICLE_GIVEN_RE = regex("^([^ ]+(?:\u02bb |\u2019 | |' ) *)(.+)$");
const PARTICLE_FAMILY_RE = regex("^([^ ]+(?:-|\u02bb|\u2019| |' ) *)(.+)$");
const SUFFIX_SEPARATOR_RE = regex("(\\s*,!*\\s*)");

/**
 * Normalize a structured personal name with CSL particles and suffixes.
 *
 * @see https://github.com/zotero/utilities/blob/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3/utilities_item.js#L500
 */
export function parseNameParticles(name: CslPersonName): void {
  if (isQuoted(name.family)) {
    name.family = name.family.slice(1, -1);
    return;
  }

  const leading = splitParticles(name.family, false);
  name.family = leading.name;
  const nonDroppingParticle = trimLast(leading.particles.join(""));
  if (nonDroppingParticle) name["non-dropping-particle"] = nonDroppingParticle;

  parseNameSuffix(name);

  const trailing = splitParticles(name.given, true);
  name.given = trailing.name;
  const droppingParticle = trailing.particles.join("").trim();
  if (droppingParticle) name["dropping-particle"] = droppingParticle;
}

function isQuoted(value: string): boolean {
  return value.length > 1 && value.startsWith('"') && value.endsWith('"');
}

function splitParticles(
  value: string,
  trailing: boolean,
): {
  name: string;
  particles: string[];
} {
  let original = value;
  let remaining = trailing ? reverse(value) : value;
  const particles: string[] = [];
  const pattern = trailing ? PARTICLE_GIVEN_RE : PARTICLE_FAMILY_RE;
  let match = pattern.exec(remaining);
  while (match) {
    const particle = trailing ? reverse(match[1]) : match[1];
    if (!startsLowercase(particle)) break;
    if (trailing) {
      particles.push(original.slice(-particle.length));
      original = original.slice(0, -particle.length);
    } else {
      particles.push(original.slice(0, particle.length));
      original = original.slice(particle.length);
    }
    remaining = match[2];
    match = pattern.exec(remaining);
  }

  if (trailing) {
    remaining = reverse(remaining);
    particles.reverse();
    for (let index = 1; index < particles.length; index++) {
      if (particles[index]?.startsWith(" "))
        particles[index - 1] = `${particles[index - 1]} `;
    }
    for (let index = 0; index < particles.length; index++) {
      if (particles[index]?.startsWith(" "))
        particles[index] = particles[index]?.slice(1) ?? "";
    }
    return { name: original.slice(0, remaining.length), particles };
  }
  return { name: original.slice(-remaining.length), particles };
}

function parseNameSuffix(name: CslPersonName): void {
  const separator = SUFFIX_SEPARATOR_RE.exec(name.given)?.[1];
  if (!separator) return;

  const index = name.given.indexOf(separator);
  const suffix = name.given.slice(index + separator.length);
  if (suffix.replaceAll(".", "") === "et al" && !name["dropping-particle"]) {
    name["dropping-particle"] = suffix;
    name["comma-dropping-particle"] = ",";
  } else {
    if (separator.replaceAll(" ", "").length === 2) name["comma-suffix"] = true;
    name.suffix = suffix;
  }
  name.given = name.given.slice(0, index);
}

function trimLast(value: string): string {
  const last = value.at(-1);
  const trimmed = value.trim();
  return last === " " && ["'", "’"].includes(trimmed.at(-1) ?? "")
    ? `${trimmed} `
    : trimmed;
}

function reverse(value: string): string {
  return Array.from(value).reverse().join("");
}

function startsLowercase(value: string): boolean {
  for (const character of value) {
    if (character.trim() !== "" && !["-", "'", "ʻ", "’"].includes(character))
      return character !== character.toUpperCase();
  }
  return false;
}
