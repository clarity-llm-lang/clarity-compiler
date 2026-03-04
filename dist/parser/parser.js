import { TokenKind } from "../lexer/tokens.js";
import { Lexer } from "../lexer/lexer.js";
import { unexpectedToken, clarityHint } from "./errors.js";
export class Parser {
    tokens;
    pos = 0;
    errors = [];
    filename;
    constructor(tokens, filename = "<stdin>") {
        this.tokens = tokens;
        this.filename = filename;
    }
    parse() {
        const mod = this.parseModule();
        return { module: mod, errors: this.errors };
    }
    // For sub-parsers used in interpolation desugaring.
    parseExprPublic() { return this.parseExpr(); }
    getErrors() { return this.errors; }
    // ============================================================
    // Module
    // ============================================================
    parseModule() {
        const start = this.peek();
        this.expect(TokenKind.Module);
        const name = this.expectIdent();
        const declarations = [];
        while (!this.isAtEnd()) {
            const decl = this.parseDeclaration();
            if (decl)
                declarations.push(decl);
        }
        return {
            kind: "ModuleDecl",
            name,
            declarations,
            span: this.spanFrom(start),
        };
    }
    // ============================================================
    // Declarations
    // ============================================================
    parseDeclaration() {
        const tok = this.peek();
        // Check for helpful hints about wrong constructs
        const hint = clarityHint(tok);
        if (hint) {
            this.errors.push(hint);
            this.advance();
            this.synchronize();
            return null;
        }
        if (tok.kind === TokenKind.Import)
            return this.parseImportDecl();
        if (tok.kind === TokenKind.Export)
            return this.parseExportedDecl();
        if (tok.kind === TokenKind.Type)
            return this.parseTypeDecl(false);
        if (tok.kind === TokenKind.Function)
            return this.parseFunctionDecl(false);
        if (tok.kind === TokenKind.Effect)
            return this.parseFunctionDecl(false);
        if (tok.kind === TokenKind.Const)
            return this.parseConstDecl(false);
        this.errors.push(unexpectedToken(tok, "a declaration (import, export, type, function, const)"));
        this.advance();
        this.synchronize();
        return null;
    }
    parseImportDecl() {
        const start = this.peek();
        this.expect(TokenKind.Import);
        this.expect(TokenKind.LBrace);
        const names = [];
        names.push(this.expectIdent());
        while (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind === TokenKind.RBrace)
                break;
            names.push(this.expectIdent());
        }
        this.expect(TokenKind.RBrace);
        this.expect(TokenKind.From);
        const fromTok = this.peek();
        if (fromTok.kind !== TokenKind.StringLiteral) {
            this.errors.push(unexpectedToken(fromTok, "a string literal module path"));
        }
        const from = fromTok.value;
        this.advance();
        return { kind: "ImportDecl", names, from, span: this.spanFrom(start) };
    }
    parseExportedDecl() {
        this.advance(); // skip 'export'
        const tok = this.peek();
        if (tok.kind === TokenKind.Type)
            return this.parseTypeDecl(true);
        if (tok.kind === TokenKind.Function)
            return this.parseFunctionDecl(true);
        if (tok.kind === TokenKind.Effect)
            return this.parseFunctionDecl(true);
        if (tok.kind === TokenKind.Const)
            return this.parseConstDecl(true);
        this.errors.push(unexpectedToken(tok, "a declaration after 'export' (type, function, const)"));
        this.advance();
        this.synchronize();
        return null;
    }
    parseTypeDecl(exported) {
        const start = this.peek();
        this.expect(TokenKind.Type);
        const name = this.expectIdent();
        const typeParams = this.parseOptionalTypeParams();
        this.expect(TokenKind.Eq);
        const typeExpr = this.parseTypeExpr();
        return { kind: "TypeDecl", name, typeParams, typeExpr, exported, span: this.spanFrom(start) };
    }
    parseFunctionDecl(exported) {
        const start = this.peek();
        const effects = this.parseOptionalEffects();
        this.expect(TokenKind.Function);
        const name = this.expectIdent();
        const typeParams = this.parseOptionalTypeParams();
        this.expect(TokenKind.LParen);
        const params = this.parseParamList();
        this.expect(TokenKind.RParen);
        this.expect(TokenKind.Arrow);
        const returnType = this.parseTypeRef();
        const body = this.parseBlock();
        return {
            kind: "FunctionDecl",
            name,
            typeParams,
            effects,
            params,
            returnType,
            body,
            exported,
            span: this.spanFrom(start),
        };
    }
    parseConstDecl(exported) {
        const start = this.peek();
        this.expect(TokenKind.Const);
        const name = this.expectIdent();
        this.expect(TokenKind.Colon);
        const typeAnnotation = this.parseTypeRef();
        this.expect(TokenKind.Eq);
        const value = this.parseExpr();
        this.expect(TokenKind.Semicolon);
        return { kind: "ConstDecl", name, typeAnnotation, value, exported, span: this.spanFrom(start) };
    }
    parseOptionalTypeParams() {
        if (this.peek().kind !== TokenKind.Lt)
            return [];
        this.advance(); // skip '<'
        const params = [];
        params.push(this.expectIdent());
        while (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind === TokenKind.Gt)
                break;
            params.push(this.expectIdent());
        }
        this.expect(TokenKind.Gt);
        return params;
    }
    parseOptionalEffects() {
        if (this.peek().kind !== TokenKind.Effect)
            return [];
        this.advance(); // skip 'effect'
        this.expect(TokenKind.LBracket);
        const effects = [];
        effects.push(this.expectIdent());
        while (this.peek().kind === TokenKind.Comma) {
            this.advance();
            effects.push(this.expectIdent());
        }
        this.expect(TokenKind.RBracket);
        return effects;
    }
    parseParamList() {
        const params = [];
        if (this.peek().kind === TokenKind.RParen)
            return params;
        params.push(this.parseParam());
        while (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind === TokenKind.RParen)
                break; // trailing comma
            params.push(this.parseParam());
        }
        return params;
    }
    parseParam() {
        const start = this.peek();
        const name = this.expectIdent();
        this.expect(TokenKind.Colon);
        const typeAnnotation = this.parseTypeRef();
        return { kind: "Parameter", name, typeAnnotation, span: this.spanFrom(start) };
    }
    // ============================================================
    // Types
    // ============================================================
    parseTypeExpr() {
        if (this.peek().kind === TokenKind.LBrace)
            return this.parseRecordType();
        if (this.peek().kind === TokenKind.Pipe)
            return this.parseUnionType();
        return this.parseTypeRef();
    }
    parseRecordType() {
        const start = this.peek();
        this.expect(TokenKind.LBrace);
        const fields = this.parseFieldList();
        this.expect(TokenKind.RBrace);
        return { kind: "RecordType", fields, span: this.spanFrom(start) };
    }
    parseUnionType() {
        const start = this.peek();
        const variants = [];
        while (this.peek().kind === TokenKind.Pipe) {
            this.advance(); // skip '|'
            variants.push(this.parseVariantDef());
        }
        return { kind: "UnionType", variants, span: this.spanFrom(start) };
    }
    parseVariantDef() {
        const start = this.peek();
        const name = this.expectIdent();
        const fields = [];
        if (this.peek().kind === TokenKind.LParen) {
            this.advance();
            fields.push(...this.parseFieldList());
            this.expect(TokenKind.RParen);
        }
        return { kind: "VariantDef", name, fields, span: this.spanFrom(start) };
    }
    parseFieldList() {
        const fields = [];
        if (this.peek().kind === TokenKind.RBrace ||
            this.peek().kind === TokenKind.RParen) {
            return fields;
        }
        fields.push(this.parseFieldDef());
        while (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind === TokenKind.RBrace ||
                this.peek().kind === TokenKind.RParen) {
                break; // trailing comma
            }
            fields.push(this.parseFieldDef());
        }
        return fields;
    }
    parseFieldDef() {
        const start = this.peek();
        const name = this.expectIdent();
        this.expect(TokenKind.Colon);
        const typeAnnotation = this.parseTypeRef();
        return { kind: "FieldDef", name, typeAnnotation, span: this.spanFrom(start) };
    }
    parseTypeRef() {
        const start = this.peek();
        // Function type: (Type, ...) -> ReturnType
        if (start.kind === TokenKind.LParen) {
            this.advance(); // skip '('
            const paramTypes = [];
            if (this.peek().kind !== TokenKind.RParen) {
                paramTypes.push(this.parseTypeRef());
                while (this.peek().kind === TokenKind.Comma) {
                    this.advance();
                    if (this.peek().kind === TokenKind.RParen)
                        break;
                    paramTypes.push(this.parseTypeRef());
                }
            }
            this.expect(TokenKind.RParen);
            this.expect(TokenKind.Arrow);
            const returnType = this.parseTypeRef();
            return {
                kind: "FunctionType",
                paramTypes,
                returnType,
                span: this.spanFrom(start),
            };
        }
        const name = this.expectIdent();
        const typeArgs = [];
        if (this.peek().kind === TokenKind.Lt) {
            this.advance();
            typeArgs.push(this.parseTypeRef());
            while (this.peek().kind === TokenKind.Comma) {
                this.advance();
                typeArgs.push(this.parseTypeRef());
            }
            this.expect(TokenKind.Gt);
        }
        return { kind: "TypeRef", name, typeArgs, span: this.spanFrom(start) };
    }
    // ============================================================
    // Expressions (Pratt parser for binary ops)
    // ============================================================
    parseExpr(minPrec = 0) {
        let left = this.parseUnary();
        while (true) {
            const prec = this.binaryPrecedence(this.peek());
            if (prec <= minPrec)
                break;
            const opToken = this.advance();
            const op = this.tokenToBinaryOp(opToken);
            const right = this.parseExpr(prec);
            left = {
                kind: "BinaryExpr",
                op,
                left,
                right,
                span: this.spanBetween(left.span, right.span),
            };
        }
        return left;
    }
    parseUnary() {
        const tok = this.peek();
        if (tok.kind === TokenKind.Minus || tok.kind === TokenKind.Bang) {
            const opToken = this.advance();
            const operand = this.parseUnary();
            return {
                kind: "UnaryExpr",
                op: opToken.value,
                operand,
                span: this.spanBetween(opToken.span, operand.span),
            };
        }
        return this.parsePostfix();
    }
    parsePostfix() {
        let expr = this.parsePrimary();
        while (true) {
            if (this.peek().kind === TokenKind.LParen) {
                // Function call
                this.advance();
                const args = this.parseArgList();
                const end = this.peek();
                this.expect(TokenKind.RParen);
                expr = {
                    kind: "CallExpr",
                    callee: expr,
                    args,
                    span: this.spanBetween(expr.span, end.span),
                };
            }
            else if (this.peek().kind === TokenKind.Dot) {
                // Member access
                this.advance();
                const memberToken = this.peek();
                const member = this.expectIdent();
                expr = {
                    kind: "MemberExpr",
                    object: expr,
                    member,
                    span: this.spanBetween(expr.span, memberToken.span),
                };
            }
            else {
                break;
            }
        }
        return expr;
    }
    parsePrimary() {
        const tok = this.peek();
        switch (tok.kind) {
            case TokenKind.IntLiteral: {
                this.advance();
                return { kind: "IntLiteral", value: BigInt(tok.value), span: tok.span };
            }
            case TokenKind.FloatLiteral: {
                this.advance();
                return { kind: "FloatLiteral", value: parseFloat(tok.value), span: tok.span };
            }
            case TokenKind.StringLiteral: {
                this.advance();
                return { kind: "StringLiteral", value: tok.value, span: tok.span };
            }
            case TokenKind.InterpolatedString: {
                this.advance();
                return this.desugarInterpolation(tok);
            }
            case TokenKind.True: {
                this.advance();
                return { kind: "BoolLiteral", value: true, span: tok.span };
            }
            case TokenKind.False: {
                this.advance();
                return { kind: "BoolLiteral", value: false, span: tok.span };
            }
            case TokenKind.Match:
                return this.parseMatchExpr();
            case TokenKind.Let:
                return this.parseLetExpr();
            case TokenKind.LBrace: {
                // Disambiguate record literal { field: expr } from block { stmts }
                // Record literal: `{` Identifier `:` (not in type annotation context)
                if (this.peekAt(1).kind === TokenKind.Identifier && this.peekAt(2).kind === TokenKind.Colon) {
                    return this.parseRecordLiteral();
                }
                // Empty braces `{}` is an empty block
                return this.parseBlock();
            }
            case TokenKind.LBracket:
                return this.parseListLiteral();
            case TokenKind.LParen: {
                this.advance();
                const expr = this.parseExpr();
                this.expect(TokenKind.RParen);
                return expr;
            }
            case TokenKind.Identifier: {
                this.advance();
                // Check for assignment: identifier = expr
                if (this.peek().kind === TokenKind.Eq) {
                    this.advance(); // skip '='
                    const value = this.parseExpr();
                    return {
                        kind: "AssignmentExpr",
                        name: tok.value,
                        value,
                        span: this.spanBetween(tok.span, value.span),
                    };
                }
                return { kind: "IdentifierExpr", name: tok.value, span: tok.span };
            }
            case TokenKind.Pipe:
                // Lambda expression: |param: Type, ...| body
                return this.parseLambda();
            default: {
                // Check for helpful hint before generic error
                const hint = clarityHint(tok);
                if (hint) {
                    this.errors.push(hint);
                }
                else {
                    this.errors.push(unexpectedToken(tok, "an expression"));
                }
                this.advance();
                // Return a dummy expression to allow parsing to continue
                return { kind: "IdentifierExpr", name: "<error>", span: tok.span };
            }
        }
    }
    // Parse a lambda expression: |param: Type, param2: Type| body_expr
    // Zero-parameter lambdas: || body_expr
    // No closures — lambdas may not reference variables from the enclosing scope.
    parseLambda() {
        const start = this.peek();
        this.expect(TokenKind.Pipe); // opening |
        const params = [];
        while (this.peek().kind !== TokenKind.Pipe && !this.isAtEnd()) {
            const paramStart = this.peek();
            const name = this.expectIdent();
            this.expect(TokenKind.Colon);
            const typeAnnotation = this.parseTypeRef();
            params.push({ kind: "Parameter", name, typeAnnotation, span: paramStart.span });
            if (this.peek().kind === TokenKind.Comma)
                this.advance();
        }
        this.expect(TokenKind.Pipe); // closing |
        const body = this.parseExpr();
        const span = { ...start.span, end: body.span.end };
        return { kind: "LambdaExpr", params, body, span };
    }
    // Desugar an InterpolatedString token into a chain of ++ BinaryExpr nodes.
    // "Hello ${name}, count: ${int_to_string(n)}!"
    // → ("Hello " ++ name) ++ (", count: " ++ (int_to_string(n) ++ "!"))
    // Empty literal segments become StringLiteral("") and are optimised away.
    desugarInterpolation(tok) {
        const { parts, exprSources } = tok.interpolation;
        const span = tok.span;
        // Parse each expression source using a sub-parser
        const exprs = exprSources.map((src, i) => {
            const subLexer = new Lexer(src, span.source);
            const subTokens = subLexer.tokenize();
            const subParser = new Parser(subTokens, span.source);
            // Push sub-parser errors into our own error list
            const exprResult = subParser.parseExprPublic();
            for (const err of subParser.getErrors()) {
                const offsetDelta = (tok.interpolation.exprOffsets[i] ?? 0);
                // Shift error spans so they point into the original source
                this.errors.push({
                    ...err,
                    span: {
                        ...err.span,
                        start: { ...err.span.start, offset: err.span.start.offset + offsetDelta },
                        end: { ...err.span.end, offset: err.span.end.offset + offsetDelta },
                    },
                });
            }
            return exprResult;
        });
        // Build right-associative ++ chain: parts[0] ++ expr[0] ++ parts[1] ++ expr[1] ++ ... ++ parts[n]
        // We build from right to left for a clean shape.
        let result = { kind: "StringLiteral", value: parts[parts.length - 1], span };
        for (let i = exprs.length - 1; i >= 0; i--) {
            // expr[i] ++ rest
            if (result.kind === "StringLiteral" && result.value === "") {
                result = exprs[i];
            }
            else {
                result = {
                    kind: "BinaryExpr", op: "++",
                    left: exprs[i], right: result, span,
                };
            }
            // parts[i] ++ (expr[i] ++ rest)
            if (parts[i] !== "") {
                result = {
                    kind: "BinaryExpr", op: "++",
                    left: { kind: "StringLiteral", value: parts[i], span },
                    right: result, span,
                };
            }
        }
        return result;
    }
    parseMatchExpr() {
        const start = this.peek();
        this.expect(TokenKind.Match);
        const scrutinee = this.parseExpr();
        this.expect(TokenKind.LBrace);
        const arms = [];
        while (this.peek().kind !== TokenKind.RBrace && !this.isAtEnd()) {
            const armStart = this.peek();
            const pattern = this.parsePattern();
            let guard;
            if (this.peek().kind === TokenKind.If) {
                this.advance(); // skip 'if'
                guard = this.parseExpr();
            }
            this.expect(TokenKind.Arrow);
            const body = this.parseExpr();
            arms.push({
                kind: "MatchArm",
                pattern,
                guard,
                body,
                span: this.spanFrom(armStart),
            });
            // Optional trailing comma
            if (this.peek().kind === TokenKind.Comma) {
                this.advance();
            }
        }
        this.expect(TokenKind.RBrace);
        return { kind: "MatchExpr", scrutinee, arms, span: this.spanFrom(start) };
    }
    parseLetExpr() {
        const start = this.peek();
        this.expect(TokenKind.Let);
        const mutable = this.peek().kind === TokenKind.Mut;
        if (mutable)
            this.advance();
        const name = this.expectIdentOrWildcard();
        let typeAnnotation;
        if (this.peek().kind === TokenKind.Colon) {
            this.advance();
            typeAnnotation = this.parseTypeRef();
        }
        this.expect(TokenKind.Eq);
        const value = this.parseExpr();
        return {
            kind: "LetExpr",
            name,
            mutable,
            typeAnnotation,
            value,
            span: this.spanFrom(start),
        };
    }
    parseBlock() {
        const start = this.peek();
        this.expect(TokenKind.LBrace);
        const statements = [];
        let result;
        while (this.peek().kind !== TokenKind.RBrace && !this.isAtEnd()) {
            const expr = this.parseExpr();
            if (this.peek().kind === TokenKind.Semicolon) {
                this.advance();
                statements.push(expr);
            }
            else if (this.peek().kind === TokenKind.RBrace) {
                // Last expression without semicolon is the result
                result = expr;
            }
            else {
                // Expression without semicolon and not at end — treat as result
                // but this might be an error if more expressions follow
                result = expr;
                break;
            }
        }
        this.expect(TokenKind.RBrace);
        return { kind: "BlockExpr", statements, result, span: this.spanFrom(start) };
    }
    parseListLiteral() {
        const start = this.peek();
        this.expect(TokenKind.LBracket);
        const elements = [];
        if (this.peek().kind !== TokenKind.RBracket) {
            elements.push(this.parseExpr());
            while (this.peek().kind === TokenKind.Comma) {
                this.advance();
                if (this.peek().kind === TokenKind.RBracket)
                    break;
                elements.push(this.parseExpr());
            }
        }
        this.expect(TokenKind.RBracket);
        return { kind: "ListLiteral", elements, span: this.spanFrom(start) };
    }
    parseRecordLiteral() {
        const start = this.peek();
        this.expect(TokenKind.LBrace);
        const fields = [];
        while (this.peek().kind !== TokenKind.RBrace && !this.isAtEnd()) {
            const fieldStart = this.peek();
            const name = this.expect(TokenKind.Identifier).value;
            this.expect(TokenKind.Colon);
            const value = this.parseExpr();
            fields.push({
                kind: "RecordFieldInit",
                name,
                value,
                span: this.spanFrom(fieldStart),
            });
            if (this.peek().kind === TokenKind.Comma) {
                this.advance();
            }
        }
        this.expect(TokenKind.RBrace);
        return { kind: "RecordLiteral", fields, span: this.spanFrom(start) };
    }
    parseArgList() {
        const args = [];
        if (this.peek().kind === TokenKind.RParen)
            return args;
        args.push(this.parseArg());
        while (this.peek().kind === TokenKind.Comma) {
            this.advance();
            if (this.peek().kind === TokenKind.RParen)
                break;
            args.push(this.parseArg());
        }
        return args;
    }
    parseArg() {
        const start = this.peek();
        // Check for named argument: name: expr
        if (this.peek().kind === TokenKind.Identifier &&
            this.peekNext().kind === TokenKind.Colon) {
            const name = this.expectIdent();
            this.advance(); // skip ':'
            const value = this.parseExpr();
            return { kind: "CallArg", name, value, span: this.spanFrom(start) };
        }
        const value = this.parseExpr();
        return { kind: "CallArg", value, span: this.spanFrom(start) };
    }
    // ============================================================
    // Patterns
    // ============================================================
    parsePattern() {
        const tok = this.peek();
        if (tok.kind === TokenKind.Underscore) {
            this.advance();
            return { kind: "WildcardPattern", span: tok.span };
        }
        if (tok.kind === TokenKind.IntLiteral) {
            this.advance();
            // Check for range pattern: 1..10
            if (this.peek().kind === TokenKind.DotDot) {
                this.advance(); // skip '..'
                const endTok = this.peek();
                if (endTok.kind === TokenKind.IntLiteral) {
                    this.advance();
                    return {
                        kind: "RangePattern",
                        start: { kind: "IntLiteral", value: BigInt(tok.value), span: tok.span },
                        end: { kind: "IntLiteral", value: BigInt(endTok.value), span: endTok.span },
                        span: this.spanFrom(tok),
                    };
                }
                this.errors.push(unexpectedToken(endTok, "an integer literal after '..'"));
            }
            return {
                kind: "LiteralPattern",
                value: { kind: "IntLiteral", value: BigInt(tok.value), span: tok.span },
                span: tok.span,
            };
        }
        if (tok.kind === TokenKind.FloatLiteral) {
            this.advance();
            return {
                kind: "LiteralPattern",
                value: { kind: "FloatLiteral", value: parseFloat(tok.value), span: tok.span },
                span: tok.span,
            };
        }
        if (tok.kind === TokenKind.StringLiteral) {
            this.advance();
            return {
                kind: "LiteralPattern",
                value: { kind: "StringLiteral", value: tok.value, span: tok.span },
                span: tok.span,
            };
        }
        if (tok.kind === TokenKind.True) {
            this.advance();
            return {
                kind: "LiteralPattern",
                value: { kind: "BoolLiteral", value: true, span: tok.span },
                span: tok.span,
            };
        }
        if (tok.kind === TokenKind.False) {
            this.advance();
            return {
                kind: "LiteralPattern",
                value: { kind: "BoolLiteral", value: false, span: tok.span },
                span: tok.span,
            };
        }
        if (tok.kind === TokenKind.Identifier) {
            this.advance();
            // Check if this is a constructor pattern: Name(...)
            if (this.peek().kind === TokenKind.LParen) {
                this.advance(); // skip '('
                const fields = [];
                if (this.peek().kind !== TokenKind.RParen) {
                    fields.push(this.parsePatternField());
                    while (this.peek().kind === TokenKind.Comma) {
                        this.advance();
                        if (this.peek().kind === TokenKind.RParen)
                            break;
                        fields.push(this.parsePatternField());
                    }
                }
                this.expect(TokenKind.RParen);
                return {
                    kind: "ConstructorPattern",
                    name: tok.value,
                    fields,
                    span: this.spanFrom(tok),
                };
            }
            // Simple binding or unit constructor (uppercase first letter = constructor)
            if (tok.value[0] >= "A" && tok.value[0] <= "Z" && tok.value !== "True" && tok.value !== "False") {
                // Uppercase identifier without parens — constructor with no fields
                return {
                    kind: "ConstructorPattern",
                    name: tok.value,
                    fields: [],
                    span: tok.span,
                };
            }
            return { kind: "BindingPattern", name: tok.value, span: tok.span };
        }
        this.errors.push(unexpectedToken(tok, "a pattern"));
        this.advance();
        return { kind: "WildcardPattern", span: tok.span };
    }
    parsePatternField() {
        const start = this.peek();
        // Check for named field: name: pattern
        if (this.peek().kind === TokenKind.Identifier &&
            this.peekNext().kind === TokenKind.Colon) {
            const name = this.expectIdent();
            this.advance(); // skip ':'
            const pattern = this.parsePattern();
            return { kind: "PatternField", name, pattern, span: this.spanFrom(start) };
        }
        const pattern = this.parsePattern();
        return { kind: "PatternField", pattern, span: this.spanFrom(start) };
    }
    // ============================================================
    // Operator Precedence
    // ============================================================
    binaryPrecedence(token) {
        switch (token.kind) {
            case TokenKind.Or: return 1;
            case TokenKind.And: return 2;
            case TokenKind.EqEq:
            case TokenKind.NotEq: return 3;
            case TokenKind.Lt:
            case TokenKind.Gt:
            case TokenKind.LtEq:
            case TokenKind.GtEq: return 4;
            case TokenKind.Plus:
            case TokenKind.Minus:
            case TokenKind.PlusPlus: return 5;
            case TokenKind.Star:
            case TokenKind.Slash:
            case TokenKind.Percent: return 6;
            default: return 0;
        }
    }
    tokenToBinaryOp(token) {
        const map = {
            "+": "+", "-": "-", "*": "*", "/": "/", "%": "%",
            "++": "++",
            "==": "==", "!=": "!=",
            "<": "<", ">": ">", "<=": "<=", ">=": ">=",
            "and": "and", "or": "or",
        };
        return map[token.value] ?? "+";
    }
    // ============================================================
    // Helpers
    // ============================================================
    peek() {
        return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
    }
    peekNext() {
        return this.tokens[this.pos + 1] ?? this.tokens[this.tokens.length - 1];
    }
    peekAt(offset) {
        return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1];
    }
    advance() {
        const tok = this.peek();
        if (!this.isAtEnd())
            this.pos++;
        return tok;
    }
    isAtEnd() {
        return this.peek().kind === TokenKind.EOF;
    }
    expect(kind) {
        const tok = this.peek();
        if (tok.kind === kind)
            return this.advance();
        this.errors.push(unexpectedToken(tok, `'${kind}'`));
        // Don't advance — let the caller decide how to recover
        return tok;
    }
    expectIdent() {
        const tok = this.peek();
        if (tok.kind === TokenKind.Identifier) {
            this.advance();
            return tok.value;
        }
        this.errors.push(unexpectedToken(tok, "an identifier"));
        return "<error>";
    }
    expectIdentOrWildcard() {
        const tok = this.peek();
        if (tok.kind === TokenKind.Identifier) {
            this.advance();
            return tok.value;
        }
        if (tok.kind === TokenKind.Underscore) {
            this.advance();
            return "_";
        }
        this.errors.push(unexpectedToken(tok, "an identifier or '_'"));
        return "<error>";
    }
    spanFrom(startToken) {
        const prev = this.tokens[this.pos - 1] ?? startToken;
        return {
            start: startToken.span.start,
            end: prev.span.end,
            source: this.filename,
        };
    }
    spanBetween(start, end) {
        return {
            start: start.start,
            end: end.end,
            source: this.filename,
        };
    }
    synchronize() {
        while (!this.isAtEnd()) {
            const tok = this.peek();
            if (tok.kind === TokenKind.Function ||
                tok.kind === TokenKind.Type ||
                tok.kind === TokenKind.Const ||
                tok.kind === TokenKind.Effect) {
                return;
            }
            if (tok.kind === TokenKind.RBrace || tok.kind === TokenKind.Semicolon) {
                this.advance();
                return;
            }
            this.advance();
        }
    }
}
//# sourceMappingURL=parser.js.map