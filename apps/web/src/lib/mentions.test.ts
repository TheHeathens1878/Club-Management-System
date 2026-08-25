import { describe, expect, it } from "vitest";

import {
  applyMention,
  filterCandidates,
  findMentionQuery,
  matchMentions,
  mentionExcerpt,
  mentionedPersonIds,
  splitMentions,
  type MentionCandidate,
} from "@/lib/mentions";

const RON: MentionCandidate = { person_id: "p-ron", name: "Ron One" };
const RON_ONEAL: MentionCandidate = { person_id: "p-oneal", name: "Ron Oneal" };
const TIA: MentionCandidate = { person_id: "p-tia", name: "Tia Two" };
const SARAH_A: MentionCandidate = { person_id: "p-sa", name: "Sarah Adams" };
const SARAH_B: MentionCandidate = { person_id: "p-sb", name: "Sarah Brown" };

const ROOM = [RON, TIA];

describe("findMentionQuery", () => {
  it("finds a bare @ at the caret", () => {
    expect(findMentionQuery("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("finds a part-typed name", () => {
    expect(findMentionQuery("hi @ro", 6)).toEqual({ start: 3, end: 6, query: "ro" });
  });

  it("keeps going across one space, because people have two names", () => {
    expect(findMentionQuery("hi @ron o", 9)).toEqual({ start: 3, end: 9, query: "ron o" });
  });

  it("gives up once the member has moved on past the name", () => {
    expect(findMentionQuery("hi @ron one can you bring the kit", 33)).toBeNull();
  });

  it("is not opened by an @ inside a word (an email address is not a mention)", () => {
    expect(findMentionQuery("mail ron@club.example", 21)).toBeNull();
  });

  it("does not reach back over a new line", () => {
    expect(findMentionQuery("@ron\nnext line", 14)).toBeNull();
  });

  it("answers for the caret, not the end of the text", () => {
    expect(findMentionQuery("@ro and more", 3)).toEqual({ start: 0, end: 3, query: "ro" });
  });

  it("has nothing to say when there is no @ before the caret", () => {
    expect(findMentionQuery("just a message", 14)).toBeNull();
  });

  it("opens after an opening bracket", () => {
    expect(findMentionQuery("(@ti", 4)).toEqual({ start: 1, end: 4, query: "ti" });
  });
});

describe("filterCandidates", () => {
  it("offers the whole room for a bare @", () => {
    expect(filterCandidates(ROOM, "").map((c) => c.person_id)).toEqual(["p-ron", "p-tia"]);
  });

  it("matches the start of the full name", () => {
    expect(filterCandidates(ROOM, "ron").map((c) => c.person_id)).toEqual(["p-ron"]);
  });

  it("matches a surname as well as a first name", () => {
    expect(filterCandidates(ROOM, "two").map((c) => c.person_id)).toEqual(["p-tia"]);
  });

  it("is case-insensitive and tolerates the space", () => {
    expect(filterCandidates(ROOM, "RON O").map((c) => c.person_id)).toEqual(["p-ron"]);
  });

  it("puts a whole-name match ahead of a mid-word one", () => {
    const room = [{ person_id: "p-x", name: "Barron Smith" }, RON];
    expect(filterCandidates(room, "ron").map((c) => c.person_id)).toEqual(["p-ron", "p-x"]);
  });

  it("returns nobody when nobody matches", () => {
    expect(filterCandidates(ROOM, "zzz")).toEqual([]);
  });
});

describe("applyMention", () => {
  it("replaces the span with the full name and a trailing space", () => {
    const span = findMentionQuery("hi @ro", 6)!;
    expect(applyMention("hi @ro", span, "Ron One")).toEqual({ text: "hi @Ron One ", caret: 12 });
  });

  it("keeps whatever followed the caret", () => {
    const span = findMentionQuery("@ro and Tia", 3)!;
    expect(applyMention("@ro and Tia", span, "Ron One")).toEqual({
      text: "@Ron One  and Tia",
      caret: 9,
    });
  });
});

describe("matchMentions", () => {
  it("finds a full name", () => {
    expect(matchMentions("morning @Ron One", ROOM)).toEqual([
      { person_id: "p-ron", name: "Ron One", start: 8, end: 16 },
    ]);
  });

  it("ignores case", () => {
    expect(mentionedPersonIds("@ron one are you about?", ROOM)).toEqual(["p-ron"]);
  });

  it("stops at the punctuation that follows", () => {
    expect(matchMentions("@Ron One, can you bring the kit?", ROOM)).toEqual([
      { person_id: "p-ron", name: "Ron One", start: 0, end: 8 },
    ]);
  });

  it("prefers the longer name when one is a prefix of the other", () => {
    expect(mentionedPersonIds("@Ron Oneal is here", [RON, RON_ONEAL])).toEqual(["p-oneal"]);
    expect(mentionedPersonIds("@Ron One is here", [RON, RON_ONEAL])).toEqual(["p-ron"]);
  });

  it("takes a unique first name on its own", () => {
    expect(mentionedPersonIds("@Tia can you lock up", ROOM)).toEqual(["p-tia"]);
  });

  it("refuses a first name two people share", () => {
    expect(matchMentions("@Sarah are you there", [SARAH_A, SARAH_B])).toEqual([]);
    expect(mentionedPersonIds("@Sarah Brown are you there", [SARAH_A, SARAH_B])).toEqual(["p-sb"]);
  });

  it("does not match someone who is not a candidate", () => {
    expect(matchMentions("@Oz Outsider hello", ROOM)).toEqual([]);
  });

  it("does not match an @ inside a word", () => {
    expect(matchMentions("ron@Ron One.example", ROOM)).toEqual([]);
  });

  it("does not treat a space after the @ as a mention", () => {
    expect(matchMentions("@ Ron One", ROOM)).toEqual([]);
  });

  it("finds several mentions in order and does not overlap them", () => {
    expect(mentionedPersonIds("@Ron One and @Tia Two, kit please", ROOM)).toEqual(["p-ron", "p-tia"]);
  });

  it("names a person mentioned twice exactly once", () => {
    expect(mentionedPersonIds("@Ron One @Ron One", ROOM)).toEqual(["p-ron"]);
    expect(matchMentions("@Ron One @Ron One", ROOM)).toHaveLength(2);
  });

  it("has nothing to find in an empty room or an empty body", () => {
    expect(matchMentions("@Ron One", [])).toEqual([]);
    expect(matchMentions("", ROOM)).toEqual([]);
  });
});

describe("splitMentions", () => {
  it("leaves a plain body in one piece", () => {
    expect(splitMentions("no mentions here", ROOM)).toEqual([
      { text: "no mentions here", person_id: null },
    ]);
  });

  it("cuts the body around each mention", () => {
    expect(splitMentions("hi @Tia Two!", ROOM)).toEqual([
      { text: "hi ", person_id: null },
      { text: "@Tia Two", person_id: "p-tia" },
      { text: "!", person_id: null },
    ]);
  });

  it("loses and duplicates nothing", () => {
    const body = "@Ron One, tell @Tia Two the pitch moved — thanks @Ron One";
    expect(
      splitMentions(body, ROOM)
        .map((s) => s.text)
        .join(""),
    ).toBe(body);
  });
});

describe("mentionExcerpt", () => {
  it("flattens the whitespace", () => {
    expect(mentionExcerpt("hello\n\n  there  ")).toBe("hello there");
  });

  it("cuts a long body and says so", () => {
    const excerpt = mentionExcerpt("x".repeat(200));
    expect(excerpt).toHaveLength(140);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("leaves a short body alone", () => {
    expect(mentionExcerpt("short")).toBe("short");
  });
});
