// M12/T9 F-375 (band B, the owner's decision `H10`) — the findings register
// is the OPEN queue, and a closed row's history lives in `CHANGELOG.md`.
//
// The owner's answer (2026-10-21): "lỗi nào fix xong và chứng minh được là đã
// fix thì được phép xóa lỗi đó trong findings, lịch sử lưu vào changelog" — a bug
// that is FIXED and PROVEN may be deleted from `docs/execution/findings.md`, and
// its history goes to `CHANGELOG.md`.
//
// The move is lossy in one direction, so this lane pins what it must not lose:
//
//   1. the register carries NO closure table any more, every row it still holds
//      carries one of the seven status words §0.3 publishes, and every row the
//      register held at the move is STILL there — a loss check, not a sameness
//      check, because §0.2 rule 8 orders every band that finds a defect to file
//      a new row here;
//   2. every closed row's id AND the commit that closed it are in
//      `CHANGELOG.md`, in the SAME entry — the register's §2 table was the only
//      record of that mapping;
//   3. the register's own preamble states the rule and names `CHANGELOG.md`.
//
// The fixture below is the register's §2 closure tables transcribed at HEAD
// (2026-10-21): 317 rows in the closure table and 51 rows in the evidence
// table, 368 closed rows in all. Each line reads "<row id> <commit token>", and the
// three rows that two commits closed carry both tokens.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTER_TEXT = readFileSync(
  path.join(REPO, "docs", "execution", "findings.md"),
  "utf8",
);
const CHANGELOG_TEXT = readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8");

/** The register's §2 closure table held this many rows at HEAD. */
const CLOSURE_TABLE_ROWS = 317;
/** The register's §2 evidence table held this many rows at HEAD. */
const EVIDENCE_TABLE_ROWS = 51;
/**
 * The rows the third band's own answers closed: they left the register with
 * their history in the changelog, so they are counted with the rest.
 */
const THIRD_BAND_CLOSED_ROWS = 5;
/**
 * The rows the deploy blocker closed: the contract refused the owner's own
 * journal, and the migration could not repair a snapshot whose shape had
 * changed. Both left the register with their history in the changelog.
 */
const DEPLOY_BLOCKER_CLOSED_ROWS = 2;
/**
 * The rows band E closed: the digest pin is re-based, so the next legitimate
 * build of the governed asset is admissible without editing the test.
 */
const BAND_E_CLOSED_ROWS = 1;
/**
 * The rows the deploy blocker's second round closed: the live config, the
 * deployed extension's assets, its manifest, the resolver on the host, and
 * the remaining state files of the deployed build were all refused by the
 * builder, so the deployment could not complete.
 */
const DEPLOY_BLOCKER_ROUND_TWO_CLOSED_ROWS = 5;
/**
 * The rows band C closed: the Skill Store owns its own schema and its own
 * governed retirement, so the `skills.*` DDL no longer lives under the
 * Knowledgebase and a wrong skill can be withdrawn through a supported path.
 */
const BAND_C_CLOSED_ROWS = 2;
/**
 * The row band A3 closed: the per-family skip expectation, so a gate tier
 * cannot go inert while the job's conclusion is still SUCCESS.
 */
const BAND_A3_CLOSED_ROWS = 1;
/**
 * The review round of 2026-10-22: the rows the review closed in their own
 * commits — the DuckDB skip family, the gate's blind spot, the merge blocker's
 * operator path, and two comments that contradicted the code beside them.
 */
const REVIEW_ROUND_CLOSED_ROWS = 5;
/**
 * The rows the owner's own answers closed on 2026-10-22 (`H9`): which copy the
 * reclamation meant, and whether its door needs a credential. Both close on the
 * ANSWER, not on a code change, so their changelog token is the phrase below.
 */
const OWNER_ANSWER_CLOSED_ROWS = 2;
/**
 * The row the completed deployment closed (2026-10-22): the apply finished with
 * a report that names its stage and transaction, so the refusal path that
 * collapsed to `APPLY_REJECTED` is proven end to end.
 */
const DEPLOY_COMPLETED_CLOSED_ROWS = 1;
/**
 * The row the real-PostgreSQL gate closed (2026-10-22): the reclamation's order
 * now runs against the container, and the reverse order is required to be
 * refused, so the proof no longer rests on a recording fake.
 */
const FINAL_VERIFICATION_CLOSED_ROWS = 1;
/**
 * The row the R10 audit band closed by fixing this lane (2026-10-23): the gate
 * pinned the register to one day's 31-row snapshot and refused four of §0.3's
 * seven status words, so filing a defect was red by construction.
 */
const R10_GATE_CLOSED_ROWS = 1;
/**
 * The M12/T9-R4 rows that have left the register with their history in the
 * changelog. Increment this when a validated R4 row is closed.
 */
const R4_CLOSED_ROWS = 78;
/** Every closed row the register's §2 carried, in the changelog now. */
const CLOSED_ROW_COUNT =
  CLOSURE_TABLE_ROWS +
  EVIDENCE_TABLE_ROWS +
  THIRD_BAND_CLOSED_ROWS +
  DEPLOY_BLOCKER_CLOSED_ROWS +
  BAND_E_CLOSED_ROWS +
  DEPLOY_BLOCKER_ROUND_TWO_CLOSED_ROWS +
  BAND_C_CLOSED_ROWS +
  BAND_A3_CLOSED_ROWS +
  REVIEW_ROUND_CLOSED_ROWS +
  OWNER_ANSWER_CLOSED_ROWS +
  DEPLOY_COMPLETED_CLOSED_ROWS +
  FINAL_VERIFICATION_CLOSED_ROWS +
  R10_GATE_CLOSED_ROWS +
  R4_CLOSED_ROWS;

/** Every closed row: "<row id> <commit token>". */
const CLOSED_ROWS = [
  ["R2-B01-02", "`ad397d4`"],
  ["R7-OB-05", "`61a60ac`"],
  ["R7-OB-04", "`2741094`"],
  ["R7-F1-09", "`8201723`"],
  ["R7-F1-08", "`8340ccc`"],
  ["R7-F1-07", "`0a70780`"],
  ["R7-F1-06", "`ea8571c`"],
  ["R7-F1-05", "`7a28ec7`"],
  ["R7-E4-01", "`661aa9c`"],
  ["R7-C2-06", "`1855416`"],
  ["R7-D11B-05", "`5820c42`"],
  ["R5-E04-06", "`2cbb462`"],
  ["R5-E14-06", "`faec89e`"],
  ["R1-A03-05", "`10a3da2`"],
  ["R5-E01-02", "`c876539`"],
  ["R5-E15-04", "`131c768`"],
  ["R1-A03-06", "`81b7e3c`"],
  ["R6-R3-NEW-02", "`ac4577c`"],
  ["R5-E14-04", "`cb6c07d`"],
  ["R2-B07-02", "`f7d949a`"],
  ["R7-OC2-03", "`a239911`"],
  ["R7-OC2-02", "`45aec4c`"],
  ["R7-OB-03", "`9588009`"],
  ["R7-H1-01", "`9f50fd6`"],
  ["R7-F2-02", "`7eb840c`"],
  ["R7-F2-01", "`9097917`"],
  ["R7-F1-04", "`7035b37`"],
  ["R7-F1-03", "`53890b7`"],
  ["R7-F1-02", "`949a8c3`"],
  ["R7-F1-01", "`61edc9b`"],
  ["R7-E1-05", "`5e918e4`"],
  ["R7-E5-02", "`5b92415`"],
  ["R7-E4-03", "`08833c0`"],
  ["R7-E4-02", "`cf64d69`"],
  ["R7-E3-04", "`2d2ce4e`"],
  ["R7-E2-04", "`3c870a4`"],
  ["R7-E1-06", "`cf9db8b`"],
  ["R7-E1-02", "`5572ab7`"],
  ["R7-C5-02", "`f37b0a4`"],
  ["R7-C2-05", "`8ff610d`"],
  ["R7-C2-04", "`84aaeb4`"],
  ["R7-C2-03", "`8687dea`"],
  ["R7-C2-02", "`a372805`"],
  ["R7-C2-01", "`0fd4883`"],
  ["R7-C1-03", "`52a2d3d`"],
  ["R7-D10B-01", "`71ca3a7`"],
  ["R7-D11A-03", "`5c027aa`"],
  ["R7-D10A-05", "`12b04ab`"],
  ["R7-D8-04", "`25dfe6b`"],
  ["R7-D5-02", "`5e20022`"],
  ["R7-D4-06", "`b6e9c0f`"],
  ["R5-E10-05", "`1c4dacd`"],
  ["R5-E10-04", "`22eb734`"],
  ["R5-E10-01", "`879613e`"],
  ["R5-E09-04", "`3c50428`"],
  ["R1-A10-07", "`64f40c4`"],
  ["R5-E16-04", "`bf4f665`"],
  ["R5-E06-08", "`8e6ca1e`"],
  ["R5-E06-06", "`ad64be5`"],
  ["R1-A14-07", "`218bc8a`"],
  ["R5-E06-02", "`610714f`"],
  ["R5-E04-04", "`099a1d2`"],
  ["R5-E02-06", "`75f7af5`"],
  ["R5-E01-04", "`b1676c8`"],
  ["R2-B08-02", "`2406013`"],
  ["R5-E12-02", "`5f57b2a`"],
  ["R5-E02-04", "`301e1f9`"],
  ["R1-A15-08", "`46181c3`"],
  ["R1-A11-05", "`23a41fc`"],
  ["R1-A10-05", "`6db8d8f`"],
  ["R1-A10-03", "`8fa4ad1`"],
  ["R6-C-NEW-01", "`846a2bb`"],
  ["R5-E04-08", "`c759246`"],
  ["R5-E03-03", "`3115fc0`"],
  ["R1-A14-05", "`4dc7a52`"],
  ["R1-A14-04", "`2c2c5fe`"],
  ["R1-A09-07", "`063d27f`"],
  ["R1-A07-06", "`c968a26`"],
  ["R5-E15-02", "`7656ccc`"],
  ["R5-E09-07", "`2977bd0`"],
  ["R5-E05-05", "`2c75a86`"],
  ["R1-A06-07", "`502c9c6`"],
  ["R1-A03-01", "`ac13e8d`"],
  ["R5-E07-04", "`a9310c1`"],
  ["R5-E02-03", "`83a6aa5`"],
  ["R1-A16-08", "`481c848`"],
  ["R1-A13-02", "`daeeda7`"],
  ["R1-A10-06", "`d299b9e`"],
  ["R7-IG-04", "`a5bb3e5`"],
  ["R7-E2-01", "`8cb52ae`"],
  ["R7-E1-03", "`1e2cbf1`"],
  ["R7-C6-04", "`acbd5f5`"],
  ["R7-C6-03", "`ff3191e`"],
  ["R7-C6-01", "`7ef4808`"],
  ["R7-C1-02", "`66dd9f3`"],
  ["R7-D11A-02", "`2f169e1`"],
  ["R7-D11A-01", "`78082ee`"],
  ["R7-D10A-02", "`88bff38`"],
  ["R7-D10A-01", "`3e43a1b`"],
  ["R7-D11B-04", "`1812803`"],
  ["R7-D8-03", "`731e6f2`"],
  ["R7-D5-01", "`6afc10f`"],
  ["R7-D4-02", "`2fadb40`"],
  ["R1-A12-08", "`26f4e29`"],
  ["R1-A12-04", "`5ec731c`"],
  ["R1-A12-01", "`3730ee5`"],
  ["R1-A05-03", "`9d6eb3e`"],
  ["R5-E05-02", "`768253f`"],
  ["R5-E04-01", "`2319878`"],
  ["R5-E03-02", "`c58653c`"],
  ["R2-B08-01", "`416b0f0`"],
  ["R1-A14-08", "`7cacb65`"],
  ["R1-A08-01", "`99c4168`"],
  ["R5-E11-01", "`26c4db9`"],
  ["R5-E06-05", "`dfe21cc`"],
  ["R1-A11-01", "`3fc27be`"],
  ["R5-E06-01", "`04847c9`"],
  ["R5-E02-02", "`0351044`"],
  ["R1-A16-07", "`2f7bb8e`"],
  ["R1-A13-04", "`a9636c1`"],
  ["R1-A11-06", "`0223c5f`"],
  ["R1-A05-08", "`496f18a`"],
  ["R5-E15-03", "`b0b8dbc`"],
  ["R2-B01-01", "`ab4333a`"],
  ["R1-A10-04", "`d5086e7`"],
  ["R1-A02-02", "`93c2aa1`"],
  ["R1-A09-05", "`8b41897`"],
  ["R1-A16-01", "`e45ba43`"],
  ["R1-A06-01", "`dd7f6ac`"],
  ["R1-A01-05", "`86a9a4b`"],
  ["R5-E15-05", "`13a69c9`"],
  ["R5-E01-05, F-240 R7-D6-01", "`263096d`"],
  ["R1-A10-02", "`c865bcd`"],
  ["R1-A07-01", "`048c438`"],
  ["R2-B02-01", "`c4295ff`"],
  ["R1-A02-01", "`c4295ff`"],
  ["R1-A04-03", "`eb1518c`"],
  ["R1-A04-08", "`c4295ff`"],
  ["R1-A06-04", "`0514732`"],
  ["R1-A10-01", "`0786790`"],
  ["R1-A15-04", "`1512d0a`"],
  ["R1-A02-08", "`c4295ff`"],
  ["R1-A06-05", "`832f082`"],
  ["R1-A06-06", "`832f082`"],
  ["R1-A06-08", "`832f082`"],
  ["R1-A07-05", "`c4295ff`"],
  ["R5-E03-04", "`ddcc0b9`"],
  ["R5-E03-08", "`072e225`"],
  ["R2-B01-05", "`c4295ff`"],
  ["R1-A09-02", "`c4295ff`"],
  ["R1-A14-03", "`c4295ff`"],
  ["R5-E02-01", "`ddcc0b9`"],
  ["R1-A11-03", "`832f082`"],
  ["R1-A15-07", "`21ce708`"],
  ["R1-A02-05", "`832f082`"],
  ["R1-A05-07", "`364bf22`"],
  ["R2-B04-02", "`c4295ff`"],
  ["R5-E03-01", "`ddcc0b9`"],
  ["R1-A05-05", "`bbfccac`"],
  ["R1-A12-05", "`e7f84b5`"],
  ["R1-A12-09", "`ee9a803`"],
  ["R2-B06-01", "`aaa0394`"],
  ["R5-E14-03", "`ea94a1f`"],
  ["R6-R3-NEW-01", "`b3c9168`"],
  ["R5-E08-06", "`45effbd`"],
  ["R7-D4-03", "`c4295ff`"],
  ["R7-D4-05", "`d0de7ee`"],
  ["R7-D1-04", "`4a8ee68`"],
  ["R7-D2-01", "`301b492`"],
  ["R7-D6-01", "`a9c9f80`"],
  ["R7-D10A-03", "`ddcc0b9`"],
  ["R7-C1-05", "`5fc0a85`"],
  ["R7-C3-02", "`d4d7c44`"],
  ["R7-C3-05", "`d4d7c44`"],
  ["R7-C3-06", "`c031ed6`"],
  ["R7-C5-05", "`f355d81`"],
  ["R7-C5B-C", "`c6f9ddf`"],
  ["R7-E1-01", "`d4d7c44`"],
  ["R7-E2-02", "`88ca6ec`"],
  ["R7-E2-05", "`764f52d`"],
  ["R7-E4-04", "`a13d675`"],
  ["R1-A02-07", "`6a31150`"],
  ["R1-A09-03", "`bcd1013`"],
  ["R1-A13-01", "`5a2b536`"],
  ["R2-B08-04", "`bcd1013`"],
  ["R1-A03-02", "`15c1779`"],
  ["R1-A03-04", "`37a17a1`"],
  ["R1-A04-02", "`15c1779`"],
  ["R1-A11-04", "`4f9ef4b`"],
  ["R2-B01-03", "`43999a7`"],
  ["R2-B03-01", "`b912a6b`"],
  ["R5-E13-01", "`6c0f814`"],
  ["R6-HUNT-01", "`6ca68d7`"],
  ["R1-A03-03", "`5309439`"],
  ["R1-A07-04", "`43999a7`"],
  ["R1-A10-08", "`65ee430`"],
  ["R5-E13-03", "`c89974e`"],
  ["R5-E13-05", "`0984b47`"],
  ["R5-E15-01", "`fc13406`"],
  ["R1-A02-03", "`b7d307e`"],
  ["R1-A06-03", "`0308434`"],
  ["R1-A08-02", "`99ed7fa`"],
  ["R1-A12-03", "`ba9bb19`"],
  ["R1-A14-06", "`ae52716`"],
  ["R1-A08-03", "`357b933`"],
  ["R1-A08-04", "`43999a7`"],
  ["R1-A11-02", "`bcd1013`"],
  ["R1-A13-06", "`ae9be15`"],
  ["R1-A15-05", "`bc29715`"],
  ["R1-A08-07", "`357b933`"],
  ["R1-A05-02", "`aa5b7bc`"],
  ["R1-A15-01", "`b00c188`"],
  ["R1-A15-02", "`bcd1013`"],
  ["R1-A16-02", "`c4087c2`"],
  ["R1-A16-03", "`15c1779`"],
  ["R1-A16-06", "`f8ecbd5`"],
  ["R2-B04-01", "`bcd1013`"],
  ["R6-V05-04", "`4d41fde`"],
  ["R1-A01-03", "`0449fed`"],
  ["R1-A04-04", "`15c1779`"],
  ["R1-A09-04", "`5309439`"],
  ["R2-B08-05", "`d9bbae2`"],
  ["R5-E12-06", "`0449fed`"],
  ["R1-A01-04", "`d78c6de`"],
  ["R2-B08-03", "`6138c9e`"],
  ["R2-B16-02", "`770a097`"],
  ["R5-E12-01", "`0449fed`"],
  ["R6-A03-01", "`eb110cb`"],
  ["R1-A15-06", "`0449fed`"],
  ["R5-E12-05", "`db63c88`"],
  ["R5-E12-07", "`0449fed`"],
  ["R1-A07-02", "`43999a7`"],
  ["R1-A09-06", "`bcd1013`"],
  ["R2-B07-01", "`fda385b`"],
  ["R5-E09-06", "`7725107`"],
  ["R1-A02-06", "`759a038`"],
  ["R1-A05-04", "`f210a1f`"],
  ["R1-A05-06", "`3defcde`"],
  ["R1-A12-02", "`5587bae`"],
  ["R1-A13-07", "`f04c32e`"],
  ["R2-B03-03", "`0a5a6c2`"],
  ["R5-E10-08", "`41d7dbf`"],
  ["R5-E14-02", "`3defcde`"],
  ["R7-D4-04", "`a328342`"],
  ["R7-D3-01", "`d211dd4`"],
  ["R7-D3-02", "`51cf325`"],
  ["R7-D7-01", "`7725107`"],
  ["R7-D8-01", "`accdef5`"],
  ["R7-D8-02", "`1b111cd`"],
  ["R7-D11B-06", "`f8ecbd5`"],
  ["R7-D12B-01", "`7725107`"],
  ["R7-D12B-02", "`957199d`"],
  ["R7-D13-01", "`c629945`"],
  ["R7-D13-02", "`4307f19`"],
  ["R7-D13-03", "`9f476d0`"],
  ["R7-D13-04", "`0e20e6f`"],
  ["R7-D13-05", "`4ec16cb`"],
  ["R7-D12A-01", "_(accepted cost — no code change)_"],
  ["R7-C1-01", "`9009dc4`"],
  ["R7-C1-04", "`6756e2c`"],
  ["R7-C3-01", "`21cc532`"],
  ["R7-C3-03", "`21cc532`"],
  ["R7-C3-04", "`21cc532`"],
  ["R7-C4-02", "`88cdf31`"],
  ["R7-C4-03", "`990f2bc`"],
  ["R7-C4-04", "`13c9e33`"],
  ["R7-C4-05", "`6ad2310`"],
  ["R7-C5-03", "`bff1967`"],
  ["R7-C5-04", "`2718aa1`"],
  ["R7-C5B-A", "`e99dbcb`"],
  ["R7-C6-02", "`b3fa7e6`"],
  ["R7-C6-06", "`255bb3c`"],
  ["R7-E1-04", "`77a34ca`"],
  ["R7-E3-03", "`69bc955`"],
  ["R7-E3-06", "`f115d4b`"],
  ["R7-E5-04", "`068e41a`"],
  ["R7-OA-02", "`189e906`"],
  ["R7-OA-04", "`a28bfba`"],
  ["R7-OB-01", "`0449fed`"],
  ["R7-OB-02", "`ec8dac2`"],
  ["R7-OC1-01", "`5c3954d`"],
  ["R7-OC1-02", "`0449fed`"],
  ["R7-OC1-03", "`0449fed`"],
  ["R7-OC1-04", "`0449fed`"],
  ["R7-OC1-05", "`0449fed`"],
  ["R7-OC1-06", "`6701075`"],
  ["R7-OC1-07", "`0449fed`"],
  ["R7-OC1-08", "`20373dc`"],
  ["R7-OC2-01", "`b012b7c`"],
  ["R7-X1-01", "`0449fed`"],
  ["R7-IG-01", "`0449fed`"],
  ["R7-IG-02", "`0449fed`"],
  ["R7-IG-03", "`0449fed`"],
  ["R7-IG-05", "`613c1e5`"],
  ["R7-IG-06", "`613c1e5`"],
  ["R7-IG-07", "`613c1e5`"],
  ["R7-IG-08", "`0449fed`"],
  ["R8-M1-01", "`d9bbae2`"],
  ["R8-M1-02", "`6138c9e`"],
  ["— (new in M12/T9; no legacy id)", "`bcd1013`"],
  ["— (new in M12/T9; no legacy id)", "`ed069a3`"],
  ["R1-A06-02", "`273522a`"],
  ["R1-A01-02", "`021403e`"],
  ["R6-A05-01", "`38ba2c2`"],
  ["R1-A07-03", "`9935149`"],
  ["R5-E05-01", "_(accepted cost — no code change)_"],
  ["R5-E16-05", "_(accepted cost — no code change)_"],
  ["R5-E03-06", "_(accepted cost — no code change)_"],
  ["R7-C4-01", "`0d14a07`"],
  ["R5-E13-04", "`6311298`"],
  ["R1-A08-06", "`bd1398c`"],
  ["R7-D11B-01", "`f2f4d15`"],
  ["R7-D11B-03", "`093439f`"],
  ["R1-A01-01", "`b18d6f0`"],
  ["R1-A08-05", "`dd4dc29`"],
  ["R7-OA-01", "`0d79cf4`"],
  ["R7-OA-03", "`db7773a`"],
  ["R1-A04-01", "`ccf2ad7`"],
  ["R1-A04-05", "`09aa698`"],
  ["R1-A04-06", "`a21c610`"],
  ["R1-A05-01", "`46852f3`"],
  ["R1-A02-04", "`46852f3`"],
  ["R1-A09-01", "`46852f3`"],
  ["R1-A13-03", "`5c156d4`"],
  ["R1-A08-08", "`6f3c970`"],
  ["R1-A12-07", "`5c156d4`"],
  ["R1-A14-01", "`b3affc2`"],
  ["R1-A14-02", "`b3affc2`"],
  ["R5-E01-03", "`7bc3e5d`"],
  ["R5-E02-05", "`b7497ca`"],
  ["R5-E04-03", "`2e7da50`"],
  ["R5-E04-02", "`812b8ec`"],
  ["R5-E05-04", "`1bab75d`"],
  ["R5-E05-06", "`8bde65f`"],
  ["R5-E06-03", "`c4833e6`"],
  ["R5-E06-04", "`710f650`"],
  ["R5-E06-07", "`96a6dd2`"],
  ["R5-E07-02", "`3701804`"],
  ["R5-E07-03", "`b7d9d36`"],
  ["R5-E08-01", "`c449cd0`"],
  ["R5-E08-02", "`ba5ff08`"],
  ["R5-E08-03", "`a108cde`"],
  ["R5-E08-04", "`d34c666`"],
  ["R5-E10-03", "`0dddea4`"],
  ["R5-E11-02", "`e47e660`"],
  ["R5-E11-03", "`3685548`"],
  ["R5-E11-04", "`68fe25b`"],
  ["R5-E11-04", "`cd1b541`"],
  ["R5-E11-05", "`0ccdd81`"],
  ["R5-E11-06", "`5e798aa`"],
  ["R5-E11-07", "`3248f60`"],
  ["R5-E12-04", "`d9e1bcc`"],
  ["R5-E13-06", "`91d788d`"],
  ["R5-E14-01", "`a4ed77d`"],
  ["R5-E14-05", "`7aebc39`"],
  ["R5-E16-01", "`d1378ba`"],
  ["R5-E16-01", "`f93068e`"],
  ["R5-E16-02", "`d1378ba`"],
  ["R5-E16-02", "`f93068e`"],
  ["R5-E16-03", "`937521c`"],
  ["R6-I01-01", "`ad4a8d6`"],
  ["R6-I01-02", "`91d788d`"],
  ["R7-GATE-01", "`9fa6505`"],
  ["R1-A12-07-BLOCK", "`5c156d4`"],
  ["R5-E01-01", "`ddcc0b9`"],
  ["R1-A13-05", "`ba9bb19`"],
  ["R1-A16-04", "`c4295ff`"],
  ["R1-A16-04", "`46852f3`"],
  ["R6-CFG-03", "`ccf2ad7`"],
  ["R5-E07-06", "`e7aee21`"],
  ["R5-E07-07", "`04e128f`"],
  ["R7-D4-01", "`cb5b83b`"],
  // The third band's own answers (2026-10-21): the rows they released and the
  // band then fixed and proved. They left the register with their history
  // here.
  ["R5-E09-01", "`ddc19be`"],
  ["R5-E09-08", "`ddc19be`"],
  ["R5-E09-02", "`65c91c8`"],
  ["R5-E13-02", "`5f1467b`"],
  ["R5-E14-07", "`11f82b2`"],
  // The deploy blocker (2026-10-21): the contract refused the owner's own
  // journal, and the migration could not repair a snapshot whose shape had
  // changed.
  ["F-376", "`42e23f5`"],
  ["F-377", "`a534adc`"],
  // Band E (2026-10-22): the digest pin is re-based, so the next legitimate
  // build of the governed asset is admissible without editing the test.
  ["R5-E10-06", "`51766eb`"],
  // The deploy blocker's second round (2026-10-22): the builder refused the
  // live config, the deployed extension's assets, its manifest, the resolver
  // on the host and the remaining state files of the deployed build, so the
  // deployment could not complete.
  ["F-378", "`b1a0a08`"],
  ["F-379", "`40c7c6b`"],
  ["F-380", "`9c64935`"],
  ["F-381", "`8b29531`"],
  ["F-382", "`7ab281d`"],
  // The review round (2026-10-22): the DuckDB capability read as an
  // unexplained skip, a lane that never ran was invisible to the skip gate,
  // the merge blocker's script was in no operator's path, and two comments
  // contradicted the code beside them.
  ["F-384", "`6cf8e0e`"],
  ["F-385", "`6f3d5c6`"],
  ["F-386", "`4a4374a`"],
  ["F-387", "`69847f2`"],
  ["F-388", "`0ae2e54`"],
  // The owner's answers of 2026-10-22 (`H9`): both rows closed on the answer,
  // so there is no code commit to name — the changelog entry carries the phrase
  // instead, exactly like the "accepted cost" rows above.
  ["F-389", "_(owner's answer — no code change)_"],
  ["F-390", "_(owner's answer — no code change)_"],
  // The deployment completed (2026-10-22): the last code change for the row is
  // the commit that named the ceremony's own refusal; the closing evidence is
  // the owner's apply, named in the same changelog entry.
  ["F-383", "`d3f64ee`"],
  // The real-PostgreSQL gate (2026-10-22) is the commit that closed the row.
  ["F-391", "`ddbd303`"],
  // The R10 band's own row (2026-10-23): the closing commit IS this lane's
  // change, because the defect was the gate pinning one day's queue snapshot.
  ["F-584", "`6468e86`"],
];

/** Every row the register holds, transcribed at HEAD. */
const REGISTER_ROW_IDS = [
  "F-013",
  "F-015",
  "F-017",
  "F-020",
  "F-045",
  "F-069",
  "F-074",
  "F-084",
  "F-090",
  "F-119",
  "F-134",
  "F-140",
  "F-142",
  "F-155",
  "F-158",
  "F-167",
  "F-169",
  "F-171",
  "F-177",
  "F-181",
  "F-200",
  "F-206",
  "F-211",
  "F-214",
  "F-224",
  "F-248",
  "F-293",
  "F-299",
  "F-324",
  "F-342",
];

/**
 * The rows this band's own answers release, and the answer each one waited on.
 *
 * A released row is OPEN WORK again: it stays in the register while it is
 * still to do, and it LEAVES the register (with its history in the changelog,
 * per the owner's `H10`) once it is fixed AND proven.
 */
const RELEASED_ROWS = {
  "F-034": "H2",
  "F-036": "H6",
  "F-094": "H5",
  "F-095": "H8",
  "F-097": "H10",
  "F-196": "H1",
  "F-197": "H3",
  "F-198": "H1",
};

/**
 * The released rows that are FIXED and PROVEN: they are deleted from the
 * register and their history lives in the changelog (the owner's `H10`), so
 * the lane asserts the deletion and the history instead of an OPEN status.
 */
const CLOSED_RELEASED_ROWS = {
  "F-034": { decision: "H2", commit: "65c91c8", legacy: "R5-E09-02" },
  "F-036": { decision: "H6", commit: "5f1467b", legacy: "R5-E13-02" },
  "F-097": { decision: "H10", commit: "11f82b2", legacy: "R5-E14-07" },
  "F-196": { decision: "H1", commit: "ddc19be", legacy: "R5-E09-01" },
  "F-198": { decision: "H1", commit: "ddc19be", legacy: "R5-E09-08" },
  "F-094": { decision: "H5", commit: "7fe9b60", legacy: "R5-E03-07" },
  "F-197": { decision: "H3", commit: "507901a", legacy: "R5-E09-03" },
  "F-095": { decision: "H8", commit: "7fe9b60", legacy: "R5-E04-05" },
};

/** The rows that are not fixed and therefore stay parked. */
const PARKED_ROWS = [];
/**
 * The last EXCLUDED rows the owner released for M12/T9-R4 on 2026-10-23.
 * They are OPEN work now, not parked exclusions.
 */
const R4_RELEASED_ROWS = ["F-045", "F-167"];

/** Every `### F-xxx` block of the register, with its Status line. */
function registerRows(markdown) {
  return markdown
    .split(/^### /mu)
    .slice(1)
    .map((block) => {
      const header = block.split("\n", 1)[0].trim();
      const id = /^F-\d+/u.exec(header)?.[0] ?? header;
      const status = /^- Status:[ ]*(.*)$/mu.exec(block)?.[1]?.trim() ?? null;
      return { id, status };
    });
}

/**
 * The seven status words §0.3 publishes. A row carrying anything else is a
 * register defect, not a queue entry.
 */
const QUEUE_STATUSES =
  /^(OPEN|LATENT|HYPOTHESIS|PARTIAL|BLOCKED|EXCLUDED|REFUTED)\b/u;

/** Rows whose `Status:` is outside §0.3's vocabulary. */
function statusViolations(rows) {
  return rows.filter((row) => !QUEUE_STATUSES.test(row.status ?? ""));
}

/**
 * Pinned ids the register no longer holds. This is a LOSS check, not a sameness
 * check: the queue is expected to grow, because §0.2 rule 8 orders every band
 * that finds a defect to file it here.
 */
function missingPinnedRows(rows) {
  const held = new Set(rows.map((row) => row.id));
  return REGISTER_ROW_IDS.filter((id) => !held.has(id));
}

/** The changelog's closure entries: one bullet per closed row. */
function closureEntries(markdown) {
  const starts = [...markdown.matchAll(/^- \*\*`([^`]+)`\*\* — /gmu)];
  return starts.map((match, at) => {
    const from = match.index ?? 0;
    const to =
      at + 1 < starts.length
        ? (starts[at + 1].index ?? markdown.length)
        : markdown.length;
    return { id: match[1], text: markdown.slice(from, to) };
  });
}

test("the register carries no closure table", () => {
  const quotedIdRows = REGISTER_TEXT.split("\n").filter((line) =>
    /^\|\s*`[^`]+`\s*\|/u.test(line),
  );
  assert.equal(
    quotedIdRows.length,
    0,
    `the register must carry no closure table; these rows still have a quoted row id \
in their first cell: ${quotedIdRows.join(" ⏎ ")}`,
  );
  const commitHeaders = REGISTER_TEXT.split("\n").filter(
    (line) =>
      /^\|/u.test(line) && /\bCommit\b/u.test(line) && !/^\|\s*-/u.test(line),
  );
  assert.equal(
    commitHeaders.length,
    0,
    `the register must carry no closure table; these table headers still name a commit \
column: ${commitHeaders.join(" ⏎ ")}`,
  );
});

test("every row the register still holds carries one of §0.3's seven status words", () => {
  const rows = registerRows(REGISTER_TEXT);
  assert.ok(rows.length > 0, "the register must still hold its queue");
  const bad = statusViolations(rows);
  assert.deepEqual(
    bad.map((row) => `${row.id}: ${row.status}`),
    [],
    `these rows carry a Status: outside the vocabulary §0.3 publishes: ${bad
      .map((row) => row.id)
      .join(", ")}`,
  );
});

test("the register still holds every row it held before the move", () => {
  const missing = missingPinnedRows(registerRows(REGISTER_TEXT));
  assert.deepEqual(
    missing,
    [],
    "the move must not lose a queue row: these ids the register held at the move are gone",
  );
});

test("a queue that has grown since the move is not a queue that lost a row", () => {
  const grown = REGISTER_ROW_IDS.map((id) => ({
    id,
    status: "OPEN — fixture: the row as it stood at the move",
  })).concat([
    { id: "F-9001", status: "OPEN — production-reachable: fixture" },
    {
      id: "F-9002",
      status: "LATENT — code-proven, untriggerable at HEAD: fixture",
    },
    { id: "F-9003", status: "BLOCKED — missing external fact: fixture" },
  ]);
  assert.deepEqual(
    missingPinnedRows(grown),
    [],
    "every band that files a defect grows this file; growth must not read as loss",
  );
});

test("a pinned row the register no longer holds is still named by the loss check", () => {
  const lost = REGISTER_ROW_IDS.map((id) => ({
    id,
    status: "OPEN — fixture: the row as it stood at the move",
  })).filter((row) => row.id !== REGISTER_ROW_IDS[0]);
  assert.deepEqual(
    missingPinnedRows(lost),
    [REGISTER_ROW_IDS[0]],
    "relaxing sameness into loss must not blind the lane to a deleted queue row",
  );
});

test("the status check takes §0.3's seven words and refuses an eighth", () => {
  const seven = [
    "OPEN — production-reachable: fixture",
    "LATENT — code-proven, untriggerable at HEAD: fixture",
    "HYPOTHESIS — fixture",
    "PARTIAL — fixture",
    "BLOCKED — missing external fact: fixture",
    "EXCLUDED — fixture",
    "REFUTED — premise measured false at HEAD: fixture",
  ].map((status, at) => ({ id: `F-91${at}`, status }));
  assert.deepEqual(
    statusViolations(seven),
    [],
    "§0.3 publishes seven status words, so all seven must pass the check",
  );
  const bogus = statusViolations([
    { id: "F-9200", status: "WATERTIGHT — invented status: fixture" },
    { id: "F-9201", status: null },
  ]);
  assert.equal(
    bogus.length,
    2,
    "a Status: outside §0.3's vocabulary, or missing, must still be refused",
  );
});

test("every closed row's id and the commit that closed it are in CHANGELOG.md", () => {
  const entries = closureEntries(CHANGELOG_TEXT);
  assert.equal(
    entries.length,
    CLOSED_ROW_COUNT,
    `CHANGELOG.md must carry one entry per closed row: ${CLOSED_ROW_COUNT} rows left the \
register's §2 tables and ${entries.length} entries are there.`,
  );
  const missing = [];
  for (const [id, token] of CLOSED_ROWS) {
    const hit = entries.some(
      (entry) => entry.id === id && entry.text.includes(token),
    );
    if (!hit) missing.push(`${id} ${token}`);
  }
  assert.deepEqual(
    missing,
    [],
    `every closed row's id and its commit must appear in the SAME CHANGELOG.md entry; \
these are lost: ${missing.join(" | ")}`,
  );
});

test("the register's preamble states the rule and names CHANGELOG.md", () => {
  const preamble = REGISTER_TEXT.split(/^### /mu)[0];
  assert.match(
    preamble,
    /0\.5/u,
    "the preamble must carry the open-queue rule as its own numbered clause",
  );
  assert.match(
    preamble,
    /`CHANGELOG\.md`/u,
    "the preamble must name CHANGELOG.md as where a closed row's history lives",
  );
  assert.match(
    preamble,
    /xóa/iu,
    "the preamble must state that a fixed and proven row is DELETED from this file",
  );
  assert.match(
    preamble,
    /chứng minh/iu,
    "the preamble must state the PROVEN condition a row has to meet before it is deleted",
  );
});

test("the rows this band's answers release are OPEN again, with the answer recorded", () => {
  const rows = new Map(registerRows(REGISTER_TEXT).map((row) => [row.id, row]));
  for (const [id, decision] of Object.entries(RELEASED_ROWS)) {
    if (CLOSED_RELEASED_ROWS[id]) continue; // fixed and proven: deleted
    const row = rows.get(id);
    assert.ok(
      row,
      `${id} must stay in the register — it is released, not fixed`,
    );
    assert.match(
      row.status ?? "",
      /^OPEN\b/u,
      `${id} is released by the owner's answer to ${decision}, so its status must be OPEN: ${row.status}`,
    );
    assert.match(
      row.status ?? "",
      new RegExp(`RELEASED 2026-10-21`, "u"),
      `${id} must record that it was released on 2026-10-21`,
    );
    assert.match(
      row.status ?? "",
      new RegExp(`\`${decision}\``, "u"),
      `${id} must name the owner's answer (${decision}) it was released by`,
    );
  }
});

test("a released row that is fixed and proven leaves the register, and its history is in the changelog", () => {
  const rows = new Map(registerRows(REGISTER_TEXT).map((row) => [row.id, row]));
  const entries = closureEntries(CHANGELOG_TEXT);
  for (const [id, { decision, commit, legacy }] of Object.entries(
    CLOSED_RELEASED_ROWS,
  )) {
    assert.equal(
      rows.has(id),
      false,
      `${id} is fixed and proven, so the owner's H10 deletes it from the register`,
    );
    const entry = entries.find((candidate) => candidate.id === legacy);
    assert.ok(
      entry,
      `${id} must carry its history in the changelog under its legacy id (${legacy})`,
    );
    assert.ok(
      entry.text.includes(id),
      `${id} must be named in the changelog's closure history`,
    );
    assert.ok(
      entry.text.includes(commit),
      `${id} must name the commit that closed it (${commit})`,
    );
    assert.ok(
      entry.text.includes(decision),
      `${id} must name the owner's answer (${decision}) it was released by`,
    );
  }
});

test("the rows that are not fixed stay parked, and the refuted rows keep their measurement", () => {
  const rows = new Map(registerRows(REGISTER_TEXT).map((row) => [row.id, row]));
  for (const id of PARKED_ROWS) {
    const row = rows.get(id);
    assert.ok(row, `${id} must stay in the register`);
    assert.match(
      row.status ?? "",
      /^EXCLUDED\b/u,
      `${id} is not fixed, so it stays EXCLUDED: ${row.status}`,
    );
  }
  for (const id of R4_RELEASED_ROWS) {
    const row = rows.get(id);
    assert.ok(row, `${id} must stay in the register`);
    assert.match(
      row.status ?? "",
      /^OPEN\b/u,
      `${id} was released for M12/T9-R4, so it is OPEN work: ${row.status}`,
    );
    assert.match(
      row.status ?? "",
      /owner/iu,
      `${id} must record that the owner released it`,
    );
  }
  const refuted = registerRows(REGISTER_TEXT).filter((row) =>
    /^REFUTED\b/u.test(row.status ?? ""),
  );
  assert.ok(refuted.length > 0, "the register keeps its refuted rows");
  for (const row of refuted) {
    assert.match(
      row.status ?? "",
      /premise|refut/iu,
      `${row.id} is REFUTED and must keep the measurement that refuted it`,
    );
  }
});

test("F-217 leaves the register, and its history is in the changelog", () => {
  // The row was parked as EXCLUDED (the owner's "ok" on 2026-10-21: band E
  // re-bases the frozen digest as its own objective). Band E fixed it and
  // proved it, so the owner's H10 deletes it from the register and its
  // history moves to the changelog.
  const rows = new Map(registerRows(REGISTER_TEXT).map((row) => [row.id, row]));
  assert.equal(
    rows.has("F-217"),
    false,
    "F-217 is fixed and proven, so the owner's H10 deletes it from the register",
  );
  const entry = closureEntries(CHANGELOG_TEXT).find(
    (candidate) => candidate.id === "R5-E10-06",
  );
  assert.ok(
    entry,
    "F-217 must carry its history in the changelog under its legacy id (R5-E10-06)",
  );
  assert.ok(
    entry.text.includes("F-217"),
    "F-217 must be named in the changelog's closure history",
  );
  assert.ok(
    entry.text.includes("51766eb"),
    "F-217 must name the commit that closed it (51766eb)",
  );
});
