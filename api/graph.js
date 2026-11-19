const NODE_ID = "41d4bfd4-2eb4-817a-8b79-000b0aa2c8ac";
const EDGE_ID = "41d4bfd4-2eb4-8135-84a8-000b82da46c9";
const VERSION = "2025-09-03";
const text = (page, key) => {
  const p = page.properties?.[key] || {};
  if (p.type === "title") return (p.title || []).map(x => x.plain_text).join("");
  if (p.type === "rich_text") return (p.rich_text || []).map(x => x.plain_text).join("");
  if (p.type === "select") return p.select?.name || "";
  if (p.type === "relation") return (p.relation || []).map(x => x.id);
  return "";
};
async function query(id, token) {
  let results = [], cursor;
  do {
    const response = await fetch("https://api.notion.com/v1/data_sources/" + id + "/query", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Notion-Version": VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    });
    if (!response.ok) throw new Error("Notion API " + response.status);
    const body = await response.json();
    results.push(...body.results);
    cursor = body.has_more ? body.next_cursor : null;
    if (results.length > 2000) throw new Error("Result limit reached");
  } while (cursor);
  return results;
}
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const { NOTION_API_KEY, GRAPH_VIEW_KEY } = process.env;
  if (!NOTION_API_KEY || !GRAPH_VIEW_KEY) return res.status(503).json({ error: "not_configured" });
  if (req.headers.authorization !== "Bearer " + GRAPH_VIEW_KEY) return res.status(401).json({ error: "unauthorized" });
  try {
    const [rawNodes, rawEdges] = await Promise.all([query(NODE_ID, NOTION_API_KEY), query(EDGE_ID, NOTION_API_KEY)]);
    const ids = new Map(rawNodes.map(n => [n.id, text(n, "노드 ID") || n.id]));
    const nodes = rawNodes.map(n => ({
      id: ids.get(n.id), title: text(n, "지식 제목"), summary: text(n, "요약"),
      type: text(n, "유형"), status: text(n, "검증 상태"), url: n.url
    }));
    const edges = rawEdges.map(e => ({
      id: text(e, "관계 ID") || e.id,
      source: ids.get(text(e, "시작 노드")[0]),
      target: ids.get(text(e, "끝 노드")[0]),
      type: text(e, "관계 유형"), description: text(e, "관계 설명"), url: e.url
    })).filter(e => e.source && e.target);
    res.status(200).json({ meta: { mode: "live", capturedOn: new Date().toISOString() }, nodes, edges });
  } catch (err) {
    res.status(502).json({ error: "notion_fetch_failed" });
  }
};
