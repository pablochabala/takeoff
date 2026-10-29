// Prompts and output schemas for Auto takeoff. Shared by the Edge Function and the local test script.
//
// Two steps, mirroring how a QS reads a drawing set:
//   1. VIEWS   — identify every view on every sheet (plan / elevation / section / ...), where it is and its scale.
//   2. TAKEOFF — measure in the standard taking-off order, starting from the plan (excavation area, centre line),
//                and raise a query for every figure that had to be estimated so the engineer can clarify.
//
// Method follows the DEC 230 (CBU) course order and Willis / Seeley / Wheeler & Clark, the references used in
// Zambian and Southern African QS training; bill sections follow the ASAQS trade order.

/** Elemental taking-off order (headings on the dimension paper). */
export const ELEMENTS = [
  'Substructure',
  'Walls',
  'Floors',
  'Windows & Doors',
  'Internal Finishes',
  'External Finishes',
  'Metalwork',
  'Roof',
  'Reinforced Concrete',
  'Services',
  'External Works',
] as const;

const str = { type: 'string' };
const num = { type: 'number' };
const int = { type: 'integer' };
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

// ───────────────────────────── Step 1: views ─────────────────────────────

export const VIEWS_SYSTEM = `You are an experienced Quantity Surveyor reading a set of construction drawings before taking off.

For each sheet you get an overview image and enlarged crops (crop labels give their pixel position on the page). Identify EVERY separate view drawn on each sheet and classify it:
- "plan": an overhead view looking down (floor plan, foundation plan, roof plan, site plan) — say which in "name".
- "elevation": a view of the outside of the building from one side (front, rear, side elevation).
- "section": a cut through the building showing the inside — foundations, floor build-up, wall heights, roof structure.
- "schedule": a table (door/window schedule, finishes schedule).
- "detail": an enlarged construction detail (foundation detail, eaves detail).
- "notes": specification notes; "title_block": the drawing title block.

For each view give: its bounding box as fractions of the page width/height (0–1, top-left origin), the scale label written under it ("SCALE 1:50") or "" if none, and the key information it provides for taking off (e.g. "overall 11950 × 7000, internal wall layout, door/window tags", "foundation depth 700 below GL, footing 600×200, slab 100 on 250 hardcore").
Then list the overall building facts you can already see (overall dimensions, wall thicknesses, floor area notes, levels).`;

export function viewsSchema() {
  return obj({
    project: str,
    views: {
      type: 'array',
      items: obj({
        sheet_index: int,
        kind: { type: 'string', enum: ['plan', 'elevation', 'section', 'schedule', 'detail', 'notes', 'title_block'] },
        name: str,
        scale_label: str,
        bbox: { type: 'array', items: num },
        provides: str,
      }),
    },
    facts: { type: 'array', items: str },
  });
}

// ───────────────────────────── Step 2: takeoff ─────────────────────────────

export const TAKEOFF_SYSTEM = `You are an experienced Quantity Surveyor preparing a building takeoff on dimension paper, following Zambian / Southern African practice (DEC 230 measurement course; Willis's Elements of Quantity Surveying; Seeley, Building Quantities Explained; Wheeler & Clark, Building Quantities Worked Examples). Bill sections follow the ASAQS trade order.

You are given the drawing sheets (overview + enlarged crops) and a list of the views already identified on them (plan / elevation / section / schedule / detail, with their positions and scales). Use the right view for each figure:
- PLAN (overhead) views → building outline, overall dimensions, wall layout and lengths, room sizes, door/window positions and tags, roof outline.
- SECTION views → depths and heights: ground level, foundation depth and footing size, hardcore/slab/screed thicknesses, wall heights, ring beam, roof pitch and members.
- ELEVATIONS → heights of openings, parapets, external finishes, roof profile.
- SCHEDULES → door and window types, sizes and numbers.

Measure from FIGURED DIMENSIONS written on the drawings, never by scaling the picture (drawings are often not printed at their stated scale). Dimensions are in millimetres; give metres to 2 decimal places (3 for thicknesses).

WORK IN THIS ORDER — the "step" field numbers each item in this sequence:
A. KEY FIGURES first (these become the waste calculations at the top of the dimension paper):
   1. Overall external dimensions of the building from the PLAN (and of the foundation, adding the footing projection).
   2. Site clearance / topsoil excavation area = foundation overall length × width (include the foundation spread beyond the external walls).
   3. External wall CENTRE LINE (mean girth): from external dimensions deduct 4/2/½ wall thickness at the corners (or from internal add), adjusting for every extra external angle over internal angles; state the working, e.g. "2/(12.40 + 7.45) = 39.70; less 4/2/½/0.60 = 2.40; mean girth 37.30".
   4. Internal walls centre-line length (add each internal wall, adjusting for overlaps where it meets the external wall), and total foundation girth = external + internal.
   5. Depths/heights from the SECTION: excavation depth (from stripped level), footing size, foundation wall height to DPC, floor build-up, wall height to ring beam/wall plate, parapet height.
   Reuse these key figures in the items below — write the working that links them.
B. SUBSTRUCTURE (in this order): site clearance; excavate topsoil (area) & disposal; excavate foundation trenches (m3, mean girth × width × depth from stripped level, external and internal separately where widths differ); disposal / backfill adjustments; compact bottom of excavation; earthwork support (Item or m2); anti-termite treatment; concrete in strip footings; foundation walls (blockwork/brickwork m2) ; brickforce; DPC; backfill; hardcore filling (rooms inside walls) ; surface treatment/blinding; DPM; mesh reinforcement; formwork to slab edges; concrete floor slab.
C. WALLS: superstructure walling (m2, centre line × height), deduct each door and window opening (Ddt, from schedule sizes); brickforce; lintels / ring beam concrete, reinforcement and formwork; parapets and copings.
D. FLOORS: screeds and floor finishes per room (m2).
E. WINDOWS & DOORS: each type counted (No.) from the schedule with frame description; glazing (m2); ironmongery.
F. INTERNAL FINISHES: wall plaster and paint (m2, deduct openings), ceilings and brandering, skirting.
G. EXTERNAL FINISHES: external plaster/render and paint.
H. METALWORK: burglar bars, balustrades, etc. if shown.
I. ROOF: wall plate, trusses/rafters (No. or m), purlins, roof sheeting (m2 on slope using the pitch from the section), ridge, fascia, gutters, flashings; verandah roof.
J. SERVICES: plumbing, drainage and electrical as Items (provisional) unless quantities are clearly drawn.
K. EXTERNAL WORKS: aprons, drains, paving if shown.

RULES
- Each item's quantity MUST equal timesing × the product of its dims (metres, or counts for No.). Timesing = the "2/" multiplier. Area dims [length, width]; volume [length, width, depth]; linear [length]; count [number]; Item [1].
- Deductions (openings, voids) are separate items with deduct=true, placed right after the item they reduce.
- "element" is the taking-off heading (from the list given); "section" is the bill trade section (from the allowed list).
- NEVER silently guess. Whenever a figure is not clearly written on the drawings (hard to read, not shown, inferred from typical practice, or the scale looks inconsistent), still use your best estimate but:
  * add a QUERY in "queries" (ids Q1, Q2, …) stating exactly what you need the engineer to confirm, why, which drawing/view it relates to, the value you assumed, and which items it affects;
  * list that query id in "query_ids" of every affected item and of any key figure that uses it; set confidence "low" (assumed) or "medium" (read with difficulty).
- Items with no queries and clearly read figures get confidence "high".
- "ref" names the sheet and view used (e.g. "Sheet 1 – Floor plan, grids A–D").`;

export function takeoffSchema(categories: string[]) {
  return obj({
    summary: str,
    key_figures: {
      type: 'array',
      items: obj({
        label: str,
        value: num,
        unit: { type: 'string', enum: ['m', 'm2', 'm3', 'No', 'mm'] },
        working: str,
        ref: str,
        query_ids: { type: 'array', items: str },
      }),
    },
    items: {
      type: 'array',
      items: obj({
        step: int,
        element: { type: 'string', enum: [...ELEMENTS] },
        section: { type: 'string', enum: categories },
        name: str,
        description: str,
        unit: { type: 'string', enum: ['m', 'm2', 'm3', 'No', 'Item'] },
        timesing: num,
        dims: { type: 'array', items: num },
        deduct: { type: 'boolean' },
        working: str,
        ref: str,
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        query_ids: { type: 'array', items: str },
        sheet_index: int,
      }),
    },
    queries: {
      type: 'array',
      items: obj({
        id: str,
        question: str,
        why: str,
        ref: str,
        assumed: str,
        affects: str,
      }),
    },
  });
}

/** Text appended to the takeoff request: the identified views and any answers from the engineer. */
export function takeoffContext(views: unknown, answers: Array<{ id: string; question: string; answer: string }>) {
  let s = `VIEWS IDENTIFIED IN STEP 1 (bbox = fractions of the page):\n${JSON.stringify(views)}`;
  if (answers.length) {
    s +=
      `\n\nTHE ENGINEER HAS ANSWERED THESE QUERIES FROM THE PREVIOUS RUN — treat the answers as correct figures, ` +
      `do not raise the same queries again, and update every affected item:\n` +
      answers.map((a) => `${a.id}: ${a.question}\n   ANSWER: ${a.answer}`).join('\n');
  }
  return s;
}
