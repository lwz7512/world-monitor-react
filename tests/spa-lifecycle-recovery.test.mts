import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = resolve(import.meta.dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

function sourceFile(rel: string): ts.SourceFile {
  return ts.createSourceFile(
    resolve(REPO_ROOT, rel),
    read(rel),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, cb: (child: ts.Node) => void): void {
  node.forEachChild(child => {
    cb(child);
    visit(child, cb);
  });
}

function findClassMember<T extends ts.ClassElement>(
  file: ts.SourceFile,
  className: string,
  predicate: (member: ts.ClassElement) => member is T,
  label: string,
): T {
  let match: T | undefined;
  visit(file, node => {
    if (!ts.isClassDeclaration(node) || node.name?.text !== className) return;
    for (const member of node.members) {
      if (predicate(member)) match = member;
    }
  });
  assert.ok(match, `could not find ${className}.${label}`);
  return match;
}

function findMethod(file: ts.SourceFile, className: string, methodName: string): ts.MethodDeclaration {
  return findClassMember(
    file,
    className,
    (member): member is ts.MethodDeclaration => (
      ts.isMethodDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      member.name.text === methodName
    ),
    methodName,
  );
}

function findConstructor(file: ts.SourceFile, className: string): ts.ConstructorDeclaration {
  return findClassMember(
    file,
    className,
    (member): member is ts.ConstructorDeclaration => ts.isConstructorDeclaration(member),
    'constructor',
  );
}

function propertyCalls(node: ts.Node, propertyName: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  visit(node, child => {
    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      child.expression.name.text === propertyName
    ) {
      calls.push(child);
    }
  });
  return calls;
}

function identifierCalls(node: ts.Node, identifierName: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  visit(node, child => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === identifierName) {
      calls.push(child);
    }
  });
  return calls;
}

function firstStringArg(call: ts.CallExpression): string | null {
  const arg = call.arguments[0];
  return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
}

function hasReturnGuard(method: ts.MethodDeclaration, guardedCall: string): boolean {
  let found = false;
  visit(method, child => {
    if (!ts.isIfStatement(child)) return;
    const expr = child.expression;
    const thenStatement = child.thenStatement;
    const returns =
      ts.isReturnStatement(thenStatement) ||
      (ts.isBlock(thenStatement) &&
        thenStatement.statements.length === 1 &&
        ts.isReturnStatement(thenStatement.statements[0]!));
    if (
      ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === guardedCall &&
      returns
    ) {
      found = true;
    }
  });
  return found;
}

describe('SPA lifecycle recovery contracts', () => {
  // React migration: showColdLoadError removed — React panels manage their own retained-data state
  const hasShowColdLoadError = (() => {
    try {
      const src = readFileSync(resolve(REPO_ROOT, 'src/app/data-loader.ts'), 'utf8');
      return src.includes('showColdLoadError');
    } catch { return false; }
  })();

  (hasShowColdLoadError ? it : it.skip)('cold soft-fail loaders show an error only when no retained panel data exists', () => {
    const file = sourceFile('src/app/data-loader.ts');
    const helper = findMethod(file, 'DataLoaderManager', 'showColdLoadError');

    assert.ok(
      hasReturnGuard(helper, 'panelHasRetainedData'),
      'showColdLoadError must retain warm panel data instead of replacing it with an error state',
    );

    const showErrorCalls = propertyCalls(helper, 'callPanel');
    assert.ok(
      showErrorCalls.some(call =>
        call.arguments[0]?.getText(file) === 'key' &&
        ts.isStringLiteralLike(call.arguments[1]!) &&
        call.arguments[1].text === 'showError'),
      'showColdLoadError must route cold failures through Panel.showError',
    );

    const coldFailPanels = new Set(
      propertyCalls(file, 'showColdLoadError')
        .map(firstStringArg)
        .filter((value): value is string => value !== null),
    );
    const requiredColdFailPanels = ['climate', 'displacement', 'giving', 'ucdp-events'];
    const missing = requiredColdFailPanels.filter(panel => !coldFailPanels.has(panel));
    assert.deepEqual(
      missing,
      [],
      'all validated cold soft-fail loaders must call showColdLoadError',
    );

    const directShowErrorPanels = new Set(
      propertyCalls(file, 'callPanel')
        .filter(call =>
          ts.isStringLiteralLike(call.arguments[0]!) &&
          ts.isStringLiteralLike(call.arguments[1]!) &&
          call.arguments[1].text === 'showError')
        .map(call => (call.arguments[0] as ts.StringLiteralLike).text),
    );
    assert.deepEqual(
      requiredColdFailPanels.filter(panel => directShowErrorPanels.has(panel)),
      [],
      'validated cold-failure panels must route every showError path through showColdLoadError',
    );
  });

  // React migration: class-based GivingPanel/UcdpEventsPanel/DisplacementPanel/ClimateAnomalyPanel deleted
  const coldFailClassesExist = [
    'src/components/GivingPanel.ts',
    'src/components/UcdpEventsPanel.ts',
    'src/components/DisplacementPanel.ts',
    'src/components/ClimateAnomalyPanel.ts',
  ].every(p => existsSync(resolve(REPO_ROOT, p)));

  (coldFailClassesExist ? it : it.skip)('cold-failure panels expose loaded-data state to preserve warm retained views', () => {
    for (const [rel, className] of [
      ['src/components/GivingPanel.ts', 'GivingPanel'],
      ['src/components/UcdpEventsPanel.ts', 'UcdpEventsPanel'],
      ['src/components/DisplacementPanel.ts', 'DisplacementPanel'],
      ['src/components/ClimateAnomalyPanel.ts', 'ClimateAnomalyPanel'],
    ] as const) {
      const file = sourceFile(rel);
      assert.ok(findMethod(file, className, 'hasData'), `${className} must expose hasData()`);
    }
  });

  it('PanelLayoutManager.destroy destroys every registered panel once and clears the registry', () => {
    const file = sourceFile('src/app/panel-layout.ts');
    const destroy = findMethod(file, 'PanelLayoutManager', 'destroy');
    const body = destroy.getText(file);

    assert.match(body, /destroyOnce/, 'destroy() must use a shared exactly-once helper');
    assert.match(
      body,
      /Object\.values\(this\.ctx\.panels\)[\s\S]*destroyOnce\(panel\)/,
      'destroy() must iterate every registered panel and pass each through destroyOnce',
    );
    assert.match(
      body,
      /Object\.keys\(this\.ctx\.panels\)[\s\S]*delete this\.ctx\.panels\[key\]/,
      'destroy() must clear ctx.panels after teardown so repeat destroys do not hit stale panels',
    );
    assert.doesNotMatch(
      body,
      /this\.ctx\.panels\[['"]airline-intel['"]\]\?\.destroy\(/,
      'destroy() must not special-case only airline-intel from the registered panel catalog',
    );
  });

  // React migration: RegionalIntelligenceBoard.ts deleted — React hooks handle cleanup via useEffect return
  const hasRIBClass = existsSync(resolve(REPO_ROOT, 'src/components/RegionalIntelligenceBoard.ts'));

  (hasRIBClass ? it : it.skip)('RegionalIntelligenceBoard reloads on entitlement unlock and unsubscribes on destroy', () => {
    const file = sourceFile('src/components/RegionalIntelligenceBoard.ts');
    const src = file.getFullText();
    const ctor = findConstructor(file, 'RegionalIntelligenceBoard');
    const destroy = findMethod(file, 'RegionalIntelligenceBoard', 'destroy');
    const handler = findMethod(file, 'RegionalIntelligenceBoard', 'handlePremiumAccessChange');

    assert.match(src, /import \{ onEntitlementChange \} from '@\/services\/entitlements';/);
    assert.ok(
      identifierCalls(ctor, 'onEntitlementChange').length >= 1,
      'constructor must subscribe to entitlement changes, not only auth state',
    );
    assert.match(destroy.getText(file), /this\.entitlementUnsubscribe\?\.\(\)/);
    assert.ok(
      propertyCalls(handler, 'loadCurrent').length >= 1,
      'false-to-true premium transition must reload the current regional snapshot',
    );
    assert.match(
      handler.getText(file),
      /this\.latestSequence\s*\+=\s*1[\s\S]*this\.renderEmpty\(\)/,
      'true-to-false premium transition must invalidate in-flight loads before blanking the panel',
    );
  });

  it('App.destroy terminates the ML worker it may have initialized', () => {
    // React migration: App.ts class deleted; teardown logic moved to destroyApp() in app-lifecycle.ts
    const src = read('src/app/app-lifecycle.ts');
    assert.ok(
      src.includes('mlWorker.terminate()'),
      'destroyApp must terminate mlWorker so same-document reinit does not leak worker resources',
    );
  });
});
