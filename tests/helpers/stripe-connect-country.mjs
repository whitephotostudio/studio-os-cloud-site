import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as orderCurrency from '../../lib/order-currency.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../../lib/stripe-connect-country.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
export const connectCountry = {};
new Function('require', 'exports', compiled)(() => orderCurrency, connectCountry);
