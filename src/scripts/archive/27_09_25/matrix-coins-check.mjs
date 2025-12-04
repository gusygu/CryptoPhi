var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _a;
// Compares coins from session settings vs coins actually persisted at latest benchmark ts.
// Usage: node --import tsx --env-file=.env src/scripts/smokes/matrix-coins-check.mts [--assert]
import { Pool } from "pg";
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var APP_SESSION = (_a = process.env.APP_SESSION_ID) !== null && _a !== void 0 ? _a : "dev-01";
var ASSERT = process.argv.includes("--assert");
function fetchSessionDoc() {
    return __awaiter(this, void 0, void 0, function () {
        var r, _a, r2, _b;
        var _c, _d, _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    _g.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, pool.query("select doc from public.str_aux_session where app_session=$1 order by ts_doc desc limit 1", [APP_SESSION])];
                case 1:
                    r = _g.sent();
                    if ((_d = (_c = r.rows) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.doc)
                        return [2 /*return*/, r.rows[0].doc];
                    return [3 /*break*/, 3];
                case 2:
                    _a = _g.sent();
                    return [3 /*break*/, 3];
                case 3:
                    _g.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, pool.query("select doc from public.v_str_aux_latest where app_session=$1 limit 1", [APP_SESSION])];
                case 4:
                    r2 = _g.sent();
                    if ((_f = (_e = r2.rows) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.doc)
                        return [2 /*return*/, r2.rows[0].doc];
                    return [3 /*break*/, 6];
                case 5:
                    _b = _g.sent();
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/, null];
            }
        });
    });
}
function tryArr(x) {
    if (!x)
        return null;
    if (Array.isArray(x))
        return x.map(String);
    return null;
}
function extractCoinsFromDoc(doc) {
    var paths = [
        ["settings", "matrices", "coins"],
        ["settings", "grid", "coins"],
        ["settings", "coins"],
        ["matrices", "coins"],
        ["grid", "coins"],
        ["coins"]
    ];
    for (var _i = 0, paths_1 = paths; _i < paths_1.length; _i++) {
        var p = paths_1[_i];
        var cur = doc;
        for (var _a = 0, p_1 = p; _a < p_1.length; _a++) {
            var k = p_1[_a];
            cur = cur === null || cur === void 0 ? void 0 : cur[k];
        }
        var arr = tryArr(cur);
        if (arr && arr.length)
            return arr.map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
    }
    return null;
}
function latestTs() {
    return __awaiter(this, void 0, void 0, function () {
        var rows;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, pool.query("select max(ts_ms) as ts from dyn_matrix_values where matrix_type='benchmark'")];
                case 1:
                    rows = (_b.sent()).rows;
                    return [2 /*return*/, ((_a = rows === null || rows === void 0 ? void 0 : rows[0]) === null || _a === void 0 ? void 0 : _a.ts) ? Number(rows[0].ts) : null];
            }
        });
    });
}
function persistedCoinsAt(ts) {
    return __awaiter(this, void 0, void 0, function () {
        var rows, S, _i, rows_1, r;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, pool.query("select base, quote from dyn_matrix_values where matrix_type='benchmark' and ts_ms = $1", [ts])];
                case 1:
                    rows = (_a.sent()).rows;
                    S = new Set();
                    for (_i = 0, rows_1 = rows; _i < rows_1.length; _i++) {
                        r = rows_1[_i];
                        if (r.base)
                            S.add(String(r.base));
                        if (r.quote)
                            S.add(String(r.quote));
                    }
                    return [2 /*return*/, __spreadArray([], S, true).sort()];
            }
        });
    });
}
function setEq(a, b) {
    if (a.length !== b.length)
        return false;
    var A = new Set(a), B = new Set(b);
    for (var _i = 0, A_1 = A; _i < A_1.length; _i++) {
        var x = A_1[_i];
        if (!B.has(x))
            return false;
    }
    return true;
}
(function () { return __awaiter(void 0, void 0, void 0, function () {
    var doc, sessionCoins, ts, dbCoins, _a, ok, S_1, D_1, missing, extra, e_1;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 6, 7, 9]);
                return [4 /*yield*/, fetchSessionDoc()];
            case 1:
                doc = _b.sent();
                sessionCoins = (doc && extractCoinsFromDoc(doc)) || [];
                return [4 /*yield*/, latestTs()];
            case 2:
                ts = _b.sent();
                if (!ts) return [3 /*break*/, 4];
                return [4 /*yield*/, persistedCoinsAt(ts)];
            case 3:
                _a = _b.sent();
                return [3 /*break*/, 5];
            case 4:
                _a = [];
                _b.label = 5;
            case 5:
                dbCoins = _a;
                console.log("[coins-check] session=".concat(APP_SESSION));
                console.log("  session coins:", sessionCoins.join(",") || "—");
                console.log("  db coins     :", dbCoins.join(",") || "—");
                console.log("  latest ts    :", ts !== null && ts !== void 0 ? ts : "—");
                ok = setEq(sessionCoins.map(function (s) { return s.toUpperCase(); }).sort(), dbCoins.map(function (s) { return s.toUpperCase(); }).sort());
                if (ok) {
                    console.log("[coins-check] OK — DB rows reflect session coin set.");
                }
                else {
                    console.log("[coins-check] MISMATCH — DB does not reflect session set.");
                    S_1 = new Set(sessionCoins), D_1 = new Set(dbCoins);
                    missing = __spreadArray([], S_1, true).filter(function (x) { return !D_1.has(x); });
                    extra = __spreadArray([], D_1, true).filter(function (x) { return !S_1.has(x); });
                    if (missing.length)
                        console.log("  missing in DB:", missing.join(","));
                    if (extra.length)
                        console.log("  extra in DB   :", extra.join(","));
                    if (ASSERT)
                        process.exit(1);
                }
                return [3 /*break*/, 9];
            case 6:
                e_1 = _b.sent();
                console.error("[coins-check] error", e_1);
                process.exit(2);
                return [3 /*break*/, 9];
            case 7: return [4 /*yield*/, pool.end()];
            case 8:
                _b.sent();
                return [7 /*endfinally*/];
            case 9: return [2 /*return*/];
        }
    });
}); })();
