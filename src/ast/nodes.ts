import type { Span } from "../errors/diagnostic.js";
import type { ClarityType } from "../checker/types.js";

// ============================================================
// Base
// ============================================================

interface BaseNode {
  span: Span;
  /** Resolved type, set by the checker during type checking. */
  resolvedType?: ClarityType;
}

// ============================================================
// Module
// ============================================================

export interface ModuleDecl extends BaseNode {
  kind: "ModuleDecl";
  name: string;
  declarations: Declaration[];
}

// ============================================================
// Declarations
// ============================================================

export type Declaration = TypeDecl | FunctionDecl | ConstDecl;

export interface TypeDecl extends BaseNode {
  kind: "TypeDecl";
  name: string;
  typeExpr: TypeExpr;
}

export interface FunctionDecl extends BaseNode {
  kind: "FunctionDecl";
  name: string;
  effects: string[];
  params: Parameter[];
  returnType: TypeNode;
  body: BlockExpr;
}

export interface ConstDecl extends BaseNode {
  kind: "ConstDecl";
  name: string;
  typeAnnotation: TypeNode;
  value: Expr;
}

export interface Parameter extends BaseNode {
  kind: "Parameter";
  name: string;
  typeAnnotation: TypeNode;
}

// ============================================================
// Type Expressions (used in type declarations)
// ============================================================

export type TypeExpr = RecordType | UnionType | TypeNode;

export interface RecordType extends BaseNode {
  kind: "RecordType";
  fields: FieldDef[];
}

export interface UnionType extends BaseNode {
  kind: "UnionType";
  variants: VariantDef[];
}

export interface VariantDef extends BaseNode {
  kind: "VariantDef";
  name: string;
  fields: FieldDef[];
}

export interface FieldDef extends BaseNode {
  kind: "FieldDef";
  name: string;
  typeAnnotation: TypeNode;
}

// ============================================================
// Type References (used in annotations)
// ============================================================

export type TypeNode = TypeRefNode | FunctionTypeNode;

export interface TypeRefNode extends BaseNode {
  kind: "TypeRef";
  name: string;
  typeArgs: TypeNode[];
}

export interface FunctionTypeNode extends BaseNode {
  kind: "FunctionType";
  paramTypes: TypeNode[];
  returnType: TypeNode;
}

// ============================================================
// Expressions
// ============================================================

export type Expr =
  | IntLiteral
  | FloatLiteral
  | StringLiteral
  | BoolLiteral
  | ListLiteral
  | RecordLiteral
  | IdentifierExpr
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | MemberExpr
  | MatchExpr
  | LetExpr
  | AssignmentExpr
  | BlockExpr;

export interface IntLiteral extends BaseNode {
  kind: "IntLiteral";
  value: bigint;
}

export interface FloatLiteral extends BaseNode {
  kind: "FloatLiteral";
  value: number;
}

export interface StringLiteral extends BaseNode {
  kind: "StringLiteral";
  value: string;
}

export interface BoolLiteral extends BaseNode {
  kind: "BoolLiteral";
  value: boolean;
}

export interface ListLiteral extends BaseNode {
  kind: "ListLiteral";
  elements: Expr[];
}

export interface RecordLiteral extends BaseNode {
  kind: "RecordLiteral";
  typeName?: string;
  fields: RecordFieldInit[];
}

export interface RecordFieldInit extends BaseNode {
  kind: "RecordFieldInit";
  name: string;
  value: Expr;
}

export interface IdentifierExpr extends BaseNode {
  kind: "IdentifierExpr";
  name: string;
}

export interface BinaryExpr extends BaseNode {
  kind: "BinaryExpr";
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "++"
  | "==" | "!="
  | "<" | ">" | "<=" | ">="
  | "and" | "or";

export interface UnaryExpr extends BaseNode {
  kind: "UnaryExpr";
  op: UnaryOp;
  operand: Expr;
}

export type UnaryOp = "-" | "!";

export interface CallExpr extends BaseNode {
  kind: "CallExpr";
  callee: Expr;
  args: CallArg[];
}

export interface CallArg extends BaseNode {
  kind: "CallArg";
  name?: string;
  value: Expr;
}

export interface MemberExpr extends BaseNode {
  kind: "MemberExpr";
  object: Expr;
  member: string;
}

export interface MatchExpr extends BaseNode {
  kind: "MatchExpr";
  scrutinee: Expr;
  arms: MatchArm[];
}

export interface MatchArm extends BaseNode {
  kind: "MatchArm";
  pattern: Pattern;
  body: Expr;
}

export interface LetExpr extends BaseNode {
  kind: "LetExpr";
  name: string;
  mutable: boolean;
  typeAnnotation?: TypeNode;
  value: Expr;
}

export interface AssignmentExpr extends BaseNode {
  kind: "AssignmentExpr";
  name: string;
  value: Expr;
}

export interface BlockExpr extends BaseNode {
  kind: "BlockExpr";
  statements: Expr[];
  result?: Expr;
}

// ============================================================
// Patterns
// ============================================================

export type Pattern =
  | WildcardPattern
  | LiteralPattern
  | ConstructorPattern
  | BindingPattern;

export interface WildcardPattern extends BaseNode {
  kind: "WildcardPattern";
}

export interface LiteralPattern extends BaseNode {
  kind: "LiteralPattern";
  value: IntLiteral | FloatLiteral | StringLiteral | BoolLiteral;
}

export interface ConstructorPattern extends BaseNode {
  kind: "ConstructorPattern";
  name: string;
  fields: PatternField[];
}

export interface PatternField extends BaseNode {
  kind: "PatternField";
  name?: string;
  pattern: Pattern;
}

export interface BindingPattern extends BaseNode {
  kind: "BindingPattern";
  name: string;
}
