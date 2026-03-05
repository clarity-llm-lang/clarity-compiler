// Returns the size in bytes of a ClarityType when stored in linear memory.
export function fieldSize(type) {
    switch (type.kind) {
        case "Int64": return 8;
        case "Float64": return 8;
        case "Timestamp": return 8; // i64 ms since epoch
        case "Bool": return 4;
        case "Unit": return 0;
        // Pointer types (i32)
        case "String":
        case "Record":
        case "Union":
        case "List":
        case "Map": // Map handle (opaque i32)
        case "Option":
        case "Result":
        case "Bytes":
            return 4;
        default: return 4;
    }
}
// Returns field alignment
export function fieldAlign(type) {
    switch (type.kind) {
        case "Int64": return 8;
        case "Float64": return 8;
        case "Timestamp": return 8;
        default: return 4;
    }
}
// Compute record layout: returns array of { name, type, offset }
export function recordLayout(fields) {
    const layout = [];
    let offset = 0;
    for (const [name, type] of fields) {
        const align = fieldAlign(type);
        offset = (offset + align - 1) & ~(align - 1); // align up
        layout.push({ name, type, offset });
        offset += fieldSize(type);
    }
    return layout;
}
// Total size of a record
export function recordSize(fields) {
    let offset = 0;
    for (const [, type] of fields) {
        const align = fieldAlign(type);
        offset = (offset + align - 1) & ~(align - 1);
        offset += fieldSize(type);
    }
    return (offset + 3) & ~3; // pad to 4-byte boundary
}
// Total size of a union (8-byte header + max variant payload).
// The header is 8 bytes (i32 tag + 4 bytes padding) so that the first field of
// any variant — even an Int64 or Float64 — lands on an 8-byte-aligned offset.
export function unionSize(variants) {
    let maxPayload = 0;
    for (const v of variants) {
        const payloadSize = recordSize(v.fields);
        if (payloadSize > maxPayload)
            maxPayload = payloadSize;
    }
    return 8 + maxPayload; // 8-byte aligned header (tag i32 + 4 bytes padding)
}
// Generate a store instruction for a specific ClarityType
export function storeField(mod, basePtr, offset, value, type) {
    switch (type.kind) {
        case "Int64":
        case "Timestamp":
            // 8-byte aligned: allocator guarantees 8-byte alignment, and recordLayout/unionSize
            // ensure i64/f64 fields land at 8-byte-aligned offsets.
            return mod.i64.store(offset, 8, basePtr, value);
        case "Float64":
            return mod.f64.store(offset, 8, basePtr, value);
        default:
            // i32 (Bool, String, pointers) — 4-byte aligned
            return mod.i32.store(offset, 4, basePtr, value);
    }
}
// Generate a load instruction for a specific ClarityType
export function loadField(mod, basePtr, offset, type) {
    switch (type.kind) {
        case "Int64":
        case "Timestamp":
            return mod.i64.load(offset, 8, basePtr);
        case "Float64":
            return mod.f64.load(offset, 8, basePtr);
        default:
            return mod.i32.load(offset, 4, basePtr);
    }
}
//# sourceMappingURL=codegen-memory.js.map