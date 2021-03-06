'use strict';

var Scope = require('./scope');
var story = require('./story');

exports.start = start;

function start(story, path, base) {
    var scope = new Scope(story, path, base);
    var stop = new Stop(scope);
    var start = scope.create('goto', 'RET', '1:1');
    return new Thread(scope.zerothChild(), stop, [start], []);
}

function Stop(scope) {
    this.scope = scope;
    Object.freeze(this);
}

// istanbul ignore next
Stop.prototype.next = function next(type, space, text, scanner) {
    // The only way to reach this method is for there to be a bug in the
    // outline lexer, or a bug in the grammar.
    if (type !== 'stop') {
        this.scope.error(scanner.position() + ': Expected end of file, got ' + tokenName(type, text) + '.');
    }
    return new End();
};

Stop.prototype.return = function _return(scope, rets, escs, scanner) {
    Scope.tie(rets, 'RET');
    Scope.tie(escs, 'ESC');
    return this;
};

function End() {
    Object.freeze(this);
}

// istanbul ignore next
End.prototype.next = function next(type, space, text, scanner) {
    return this;
};

// rets are tied to the next instruction
// escs are tied off after the next encountered prompt
function Thread(scope, parent, rets, escs) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    Object.freeze(this);
}

Thread.prototype.next = function next(type, space, text, scanner) {
    if (type === 'symbol'|| type === 'alphanum' || type === 'number' || type === 'literal' || text === '--' || text === '---') {
        return new Text(this.scope, space, text, this, this.rets);
    }  else if (type === 'token') {
        if (text === '{') {
            return new Block(this.scope, new ThenExpect('token', '}', this), this.rets);
        } else if (text === '@') {
            return label(this.scope, new Label(this, this.rets));
        } else if (text === '->') {
            return label(this.scope, new Goto(this, this.rets));
        } else if (text === '<-') {
            // Explicitly tie rets to null by dropping them.
            Scope.tie(this.rets, 'RET');
            // Continue carrying escs to the next encountered prompt.
            // Advance the path so that option thread don't appear empty.
            return new Thread(this.scope.next(), this.parent, [], this.escs);
        } else if (text === '/') {
            var node = this.scope.create('break', null, scanner.position());
            this.scope.tie(this.rets);
            return new Thread(this.scope.next(), this.parent, [node], this.escs);
        } else if (text === '//') {
            var node = this.scope.create('paragraph', null, scanner.position());
            this.scope.tie(this.rets);
            return new Thread(this.scope.next(), this.parent, [node], this.escs);
        } else if (text === '{"' || text === '{\'' || text === '"}' || text === '\'}') {
            return new Text(this.scope, space, '', this, this.rets)
                .next(type, '', text, scanner);
        } else if (text === '<') {
            return label(this.scope, new ThenExpect('token', '>', new Cue(this, this.rets, this.escs)));
        }
    } else if (type === 'start') {
        if (text === '+' || text === '*') {
            return new MaybeOption(this.scope, new ThenExpect('stop', '', this), this.rets, [], text);
        } else if (text === '-') {
            return new MaybeThread(this.scope, new ThenExpect('stop', '', this), this.rets, [], [], ' ');
        } else if (text === '>') {
            var node = this.scope.create('ask', null, scanner.position());
            // tie off rets to the prompt.
            this.scope.tie(this.rets);
            // promote escs to rets, tying them off after the prompt.
            var escs = this.escs.slice();
            this.escs.length = 0;
            return new Thread(this.scope.next(), new ThenExpect('stop', '', this), escs, []);
        } else { // if text === '!') {
            return new Program(this.scope, new ThenExpect('stop', '', this), this.rets, []);
        }
    } else if (type === 'dash') {
        var node = this.scope.create('rule', null, scanner.position());
        this.scope.tie(this.rets);
        return new Thread(this.scope.next(), this.parent, [node], this.escs);
    } else if (type === 'break') {
        return this;
    }
    if (type === 'stop' || text === '|' || text === ']' || text === '[' || text === '}') {
        return this.parent.return(this.scope, this.rets, this.escs, scanner)
            .next(type, space, text, scanner);
    }
    return new Text(this.scope, space, text, this, this.rets);
};

Thread.prototype.return = function _return(scope, rets, escs, scanner) {
    // All rules above (in next) guarantee that this.rets has been passed to
    // any rule that might use them. If the rule fails to use them, they must
    // return them. However, escs are never passed to any rule that returns.
    return new Thread(scope, this.parent, rets, this.escs.concat(escs));
};

function Text(scope, lift, text, parent, rets) {
    this.scope = scope;
    this.lift = lift;
    this.text = text;
    this.parent = parent;
    this.rets = rets;
    Object.seal(this);
}

Text.prototype.next = function next(type, space, text, scanner) {
    if (type === 'alphanum' || type === 'number' || type === 'symbol' || type === 'literal') {
        this.text += space + text;
        return this;
    } else if (type === 'token') {
        if (text === '{"') {
            this.text += space + '“';
            return this;
        } else if (text === '"}') {
            this.text += space + '”';
            return this;
        } else if (text === '{\'') {
            this.text += space + '‘';
            return this;
        } else if (text === '\'}') {
            this.text += space + '’';
            return this;
        }
    } else if (text === '--') {
        this.text += space + '–'; // en-dash
        return this;
    } else if (text === '---') {
        this.text += space + '—'; // em-dash
        return this;
    }
    this.scope.tie(this.rets);
    var node = this.scope.create('text', this.text, scanner.position());
    node.lift = this.lift;
    node.drop = space;
    return this.parent.return(this.scope.next(), [node], [], scanner)
        .next(type, space, text, scanner);
};

function MaybeThread(scope, parent, rets, escs, skips, space) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    this.skips = skips;
    this.space = space || '';
    Object.freeze(this);
};

MaybeThread.prototype.next = function next(type, space, text, scanner) {
    if (type === 'token') {
        if (text === '{') {
            return expression(this.scope,
                new ThenExpect('token', '}',
                    new ThreadCondition(this.parent, this.rets, this.escs, this.skips)));
        }
    }
    return new Thread(this.scope, this, this.rets, this.escs)
        .next(type, this.space || space, text, scanner);
};

MaybeThread.prototype.return = function _return(scope, rets, escs, scanner) {
    return this.parent.return(scope, rets.concat(this.skips), escs, scanner);
};

function ThreadCondition(parent, rets, escs, skips) {
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    this.skips = skips;
    Object.freeze(this);
}

ThreadCondition.prototype.return = function _return(scope, args, scanner) {
    var node = scope.create('jump', invertExpression(args), scanner.position());
    var branch = new Branch(node);
    scope.tie(this.rets);
    return new MaybeThread(scope.next(), this.parent, [node], this.escs, this.skips.concat([branch]));
};

function MaybeOption(scope, parent, rets, escs, leader) {
    this.scope = scope;
    this.at = scope;
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    this.leader = leader;
    this.conditions = [];
    this.consequences = [];
    this.keywords = {};
    this.descended = false;
    Object.seal(this);
}

MaybeOption.prototype.next = function next(type, space, text, scanner) {
    if (type === 'token') {
        if (text === '{') {
            return new OptionOperator(this.scope,
                new ThenExpect('token', '}', this));
        }
        // Recognize the inequality token as individual keyword tokens with an
        // empty string amid them in this context.
        if (text === '<>') {
            return this.return(this.scope, 'keyword', '');
        }
        if (text === '<') {
            return new Keyword(this.scope, this);
        }
    }
    return this.option(scanner).next(type, space, text, scanner);
};

MaybeOption.prototype.return = function _return(scope, operator, expression, modifier, scanner) {
    if (operator === '+' || operator === '-' || operator === '!') {
        modifier = modifier || ['val', 1];
    }
    if (operator === '?') {
        modifier = modifier || ['val', 0];
    }
    if (operator === '+' || operator === '-') {
        this.consequences.push([expression, [operator, expression, modifier]]);
    }
    if (operator === '-') {
        this.conditions.push(['>=', expression, modifier]);
    }
    if (operator === '') {
        this.conditions.push(expression);
    }
    if (operator === '=' || operator === '!' || operator === '?') {
        this.conditions.push(['<>', expression, modifier]);
        this.consequences.push([expression, modifier]);
    }
    if (operator === 'keyword') {
        this.keywords[expression] = true;
    }
    return this;
};

MaybeOption.prototype.advance = function advance() {
    if (this.descended) {
        this.at = this.at.next();
    } else {
        this.at = this.at.firstChild();
        this.descended = true;
    }
};

MaybeOption.prototype.option = function option(scanner) {
    var variable = this.scope.name();
    var rets = [];

    this.at.tie(this.rets);

    if (this.leader === '*') {
        this.consequences.push([['get', variable], ['+', ['get', variable], ['val', 1]]]);
        var jump = this.at.create('jump', ['<>', ['get', variable], ['val', 0]], scanner.position());
        var jumpBranch = new Branch(jump);
        rets.push(jumpBranch);
        this.advance();
        this.at.tie([jump]);
    }

    for (var i = 0; i < this.conditions.length; i++) {
        var condition = this.conditions[i];
        var jump = this.at.create('jump', ['==', condition, ['val', 0]], scanner.position());
        var jumpBranch = new Branch(jump);
        rets.push(jumpBranch);
        this.advance();
        this.at.tie([jump]);
    }

    var option = new Option(this.scope, this.parent, rets, this.escs, this.leader, this.consequences);
    option.node = this.at.create('option', null, scanner.position());
    option.node.keywords = Object.keys(this.keywords).sort();
    this.advance();

    option.next = this.at;
    return option.thread(scanner,
        new OptionThread(this.at, option, [], option, 'qa', AfterInitialQA));
};

// Captures <keyword> annotations on options.
function Keyword(scope, parent) {
    this.scope = scope;
    this.parent = parent;
    this.keyword = '';
    this.space = '';
    Object.seal(this);
}

Keyword.prototype.next = function next(type, space, text, scanner) {
    if (text === '>') {
        return this.parent.return(this.scope, 'keyword', this.keyword);
    }
    this.keyword += (this.space && space) + text;
    this.space = ' ';
    return this;
};

// {+x}, {-x}, {!x}, {+n x}, {-n x}, {=n x} or simply {x}
function OptionOperator(scope, parent) {
    this.scope = scope;
    this.parent = parent;
    Object.freeze(this);
}

OptionOperator.prototype.next = function next(type, space, text, scanner) {
    if (text === '+' || text === '-' || text === '=' || text === '!' || text === '?') {
        return expression(this.scope,
            new OptionArgument(this.parent, text));
    } else {
        return expression(this.scope,
            new OptionArgument2(this.parent, ''))
                .next(type, space, text, scanner);
    }
};

function OptionArgument(parent, operator) {
    this.parent = parent;
    this.operator = operator;
    Object.freeze(this);
}

OptionArgument.prototype.return = function _return(scope, args, scanner) {
    if (args[0] === 'get' || args[0] === 'var') {
        return this.parent.return(scope, this.operator, args, this.args, scanner);
    } else {
        return expression(scope,
            new OptionArgument2(this.parent, this.operator, args));
    }
};

function OptionArgument2(parent, operator, args) {
    this.parent = parent;
    this.operator = operator;
    this.args = args;
    Object.freeze(this);
}

OptionArgument2.prototype.return = function _return(scope, args, scanner) {
    return this.parent.return(scope, this.operator, args, this.args, scanner);
};

function Option(scope, parent, rets, escs, leader, consequences) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets; // to tie off to the next option
    this.escs = escs; // to tie off to the next node after the next prompt
    this.node = null;
    this.leader = leader;
    this.consequences = consequences;
    this.next = scope.next();
    this.mode = '';
    this.branch = null;
    Object.seal(this);
}

Option.prototype.return = function _return(scope, rets, escs, scanner) {
    // Create a jump from the end of the answer.
    if (this.mode !== 'a') {
        // If the answer is reused in the question, create a dedicated jump and
        // add it to the end of the answer.
        var jump = scope.create('goto', 'RET', scanner.position());
        this.node.answer.push(scope.name());
        rets.push(jump);
    }

    return this.parent.return(
        this.scope.next(),
        this.rets.concat([this.node]),
        this.escs.concat(rets, escs),
        scanner
    );
};

Option.prototype.thread = function thread(scanner, parent) {
    // Creat a dummy node, to replace if necessary, for arcs that begin with a
    // goto/divert arrow that otherwise would have loose rets to forward.
    var placeholder = this.next.create('goto', 'RET', scanner.position());
    return new Thread(this.next, parent, [placeholder], []);
};

Option.prototype.push = function push(scope, mode) {
    var next = this.next.name();
    var end = scope.name();
    if (next !== end) {
        if (mode === 'q' || mode === 'qa') {
            this.node.question.push(next);
        }
        if (mode === 'a' || mode === 'qa') {
            this.node.answer.push(next);
        }
        this.next = scope;
        this.mode = mode;
    }
};

// An option thread captures the end of an arc, and if the path has advanced,
// adds that arc to the option's questions and/or answer depending on the
// "mode" ("q", "a", or "qa") and proceeds to the following state.
function OptionThread(scope, parent, rets, option, mode, Next) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.option = option;
    this.mode = mode;
    this.Next = Next;
    Object.freeze(this);
}

OptionThread.prototype.return = function _return(scope, rets, escs, scanner) {
    this.option.push(scope, this.mode);
    // TODO investigate whether we can consistently tie of received rets
    // instead of passing them forward to OptionThread, which consistently
    // just terminates them on their behalf.
    Scope.tie(this.rets, 'RET');
    // TODO no test exercises this kind of jump.
    Scope.tie(escs, 'ESC');
    return new this.Next(scope, this.parent, rets, this.option);
};

// Every option begins with a (potentially empty) thread before the first open
// backet that will contribute both to the question and the answer.
function AfterInitialQA(scope, parent, rets, option) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.option = option;
    Object.freeze(this);
}

AfterInitialQA.prototype.next = function next(type, space, text, scanner) {
    // istanbul ignore else
    if (type === 'token' && text === '[') {
        return this.option.thread(scanner, new AfterQorA(this.scope, this, this.rets, this.option));
    } else {
        this.scope.error(scanner.position() + ': Expected "[]" brackets in option but got ' + tokenName(type, text) + '.');
        return this.return(this.scope, this.rets, [], scanner);
    }
};

// The thread returns to this level after capturing the bracketed terms, after
// which anything and everything to the end of the block contributes to the
// answer.
AfterInitialQA.prototype.return = function _return(scope, rets, escs, scanner) {
    Scope.tie(rets, 'RET');
    // TODO no test exercises these escs.
    Scope.tie(escs, 'ESC');

    rets = [];

    // Thread consequences, including incrementing the option variable name
    var consequences = this.option.consequences;
    if (consequences.length) {
        this.option.node.answer.push(scope.name());
    }
    for (var i = 0; i < consequences.length; i++) {
        var consequence = consequences[i];
        var node = scope.create('move', null, scanner.position());
        node.source = consequence[1];
        node.target = consequence[0];
        scope.tie(rets);
        scope = scope.next();
        rets = [node];
    }

    this.option.next = scope;
    return this.option.thread(scanner,
        new OptionThread(scope, this.parent, rets, this.option, 'a', AfterFinalA));
};

// After capturing the first arc within brackets, which may either contribute
// to the question or the answer, we decide which based on whether there is a
// following bracket.
function DecideQorA(scope, parent, rets, option) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.option = option;
    Object.freeze(this);
}

DecideQorA.prototype.next = function next(type, space, text, scanner) {
    if (type === 'token' && text === '[') { // A
        this.option.push(this.scope, 'a');
        return this.option.thread(scanner,
            new OptionThread(this.scope, this, this.rets, this.option, 'q', ExpectFinalBracket));
    } else if (type === 'token' && text === ']') { // Q
        this.option.push(this.scope, 'q');
        return this.parent.return(this.scope, this.rets, [], scanner);
    } else {
        this.scope.error(scanner.position() + ': Expected "]" to end option but got ' + tokenName(type, text) + '.');
        return this.parent.return(this.scope, this.rets, [], scanner);
    }
};

// If the brackets contain a sequence of question thread like [A [Q] QA [Q]
// QA...], then after each [question], we return here for continuing QA arcs.
DecideQorA.prototype.return = function _return(scope, rets, escs, scanner) {
    // TODO no test exercises these escs.
    Scope.tie(escs, 'ESC');
    return this.option.thread(scanner,
        new OptionThread(scope, this.parent, rets, this.option, 'qa', AfterQA));
};

// After a Question/Answer thread, there can always be another [Q] thread
// ad nauseam. Here we check whether this is the end of the bracketed
// expression or continue after a [Question].
function AfterQA(scope, parent, rets, option) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.option = option;
    Object.freeze(this);
}

AfterQA.prototype.next = function next(type, space, text, scanner) {
    if (type === 'token' && text === '[') {
        return this.option.thread(scanner,
            new OptionThread(this.scope, this, this.rets, this.option, 'q', ExpectFinalBracket));
    } else if (type === 'token' && text === ']') {
        return this.parent.return(this.scope, this.rets, [], scanner);
    } else {
        this.scope.error(scanner.position() + ': Expected "]" to end option but got ' + tokenName(type, text) + '.');
        return this.parent.return(this.scope, this.rets, [], scanner);
    }
};

AfterQA.prototype.return = function _return(scope, rets, escs, scanner) {
    // TODO terminate returned scope
    // TODO no test exercises these escapes.
    Scope.tie(escs, 'ESC');
    return this.option.thread(scanner,
        new OptionThread(this.scope, this.parent, rets, this.option, 'qa', ExpectFinalBracket));
};

// The bracketed terms may either take the form [Q] or [A, ([Q] QA)*].
// This captures the first arc without committing to either Q or A until we
// know whether it is followed by a bracketed term.
function AfterQorA(scope, parent, rets, option) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.option = option;
    Object.freeze(this);
}

// Just capture the path and proceed.
AfterQorA.prototype.return = function _return(scope, rets, escs, scanner) {
    // TODO consider whether this could have been done earlier.
    Scope.tie(this.rets, 'RET');
    // TODO no test exercises these escapes.
    Scope.tie(escs, 'ESC');
    return new DecideQorA(scope, this.parent, rets, this.option);
};

// After a [Q] or [A [Q] QA...] block, there must be a closing bracket and we
// return to the parent arc of the option.
function ExpectFinalBracket(scope, parent, rets, option) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.option = option;
    Object.freeze(this);
}

ExpectFinalBracket.prototype.next = function next(type, space, text, scanner) {
    if (type !== 'token' || text !== ']') {
        this.scope.error(scanner.position() + ': Expected "]" to end option.');
        return this.parent.return(this.scope, this.rets, [], scanner)
            .next('token', space, ']', scanner);
    }
    return this.parent.return(this.scope, this.rets, [], scanner);
};

// After the closing bracket in an option], everything that remains is the last
// node of the answer. After that thread has been submitted, we expect the
// block to end.
function AfterFinalA(scope, parent, rets, option) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    Object.freeze(this);
}

AfterFinalA.prototype.next = function next(type, space, text, scanner) {
    return this.parent.return(this.scope, this.rets, [], scanner)
        .next(type, space, text, scanner);
};

// This concludes the portion dedicated to parsing options

// Branch is a fake story node. It serves to mark that the wrapped node's
// "branch" label should be tied instead of its "next" label.
function Branch(node) {
    this.type = 'branch';
    this.node = node;
    Object.freeze(this);
}

function Label(parent, rets) {
    this.parent = parent;
    this.rets = rets;
    Object.freeze(this);
}

Label.prototype.return = function _return(scope, expression, scanner) {
    if (expression[0] === 'get') {
        var label = expression[1];
        if (label === '...') {
            var node = scope.create('goto', 'RET', scanner.position());
            scope.tie(this.rets);
            return new Thread(scope, new Loop(scope, this.parent), [node], []);
        } else {
            var labelScope = scope.label(label);
            // place-holder goto thunk
            var node = labelScope.create('goto', 'RET', scanner.position());
            scope.tie(this.rets);
            // rets also forwarded so they can be tied off if the goto is replaced.
            return this.parent.return(labelScope, this.rets.concat([node]), [], scanner);
        }
    } else if (expression[0] === 'call') {
        var label = expression[1][1];
        var labelScope = scope.label(label);
        var node = labelScope.create('def', null, scanner.position());
        var params = [];
        for (var i = 2; i < expression.length; i++) {
            var arg = expression[i];
            if (arg[0] === 'get') {
                params.push(arg[1]);
            } else {
                scope.error(scanner.position() + ': Expected parameter name but got expression.');
            }
        }
        node.locals = params;
        return new Thread(labelScope.next(),
            new ConcludeProcedure(scope, this.parent, this.rets),
            [node], []);
    } else {
        scope.error(scanner.position() + ': Expected label after "@".');
        return new Thread(scope, this.parent, this.rets, []);
    }
};

function Loop(scope, parent) {
    this.scope = scope;
    this.parent = parent;
    this.label = scope.name();
    Object.freeze(this);
}

Loop.prototype.return = function _return(scope, rets, escs, scanner) {
    // tie back rets
    this.scope.tie(rets);
    // TODO tie back escs
    return this.parent.return(scope, [], [], scanner);
};

function ConcludeProcedure(scope, parent, rets) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    Object.freeze(this);
};

ConcludeProcedure.prototype.return = function _return(scope, rets, escs, scanner) {
    // After a procedure, connect prior rets.
    Scope.tie(rets, 'RET');
    // Dangling escs go to an escape instruction, to follow the jump path in
    // the parent scope, determined at run time.
    Scope.tie(escs, 'ESC');
    return this.parent.return(this.scope, this.rets, [], scanner);
};

function Goto(parent, rets) {
    this.parent = parent;
    this.rets = rets;
}

Goto.prototype.return = function _return(scope, args, scanner) {
    if (args[0] === 'get') {
        Scope.tie(this.rets, args[1]);
        return this.parent.return(scope.next(), [], [], scanner);
    } else if (args[0] === 'call') {
        var label = args[1][1];
        var node = scope.create('call', label, scanner.position());
        node.args = args.slice(2);
        scope.tie(this.rets);
        return this.parent.return(scope.next(), [node], [new Branch(node)], scanner);
    } else {
        scope.error(scanner.position() + ': Expected label after goto arrow but got expression.');
        return new Thread(scope, this.parent, this.rets, []);
    }
};

function Cue(parent, rets, escs) {
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    Object.freeze(this);
}

Cue.prototype.return = function _return(scope, expression, scanner) {
    if (expression.length === 0 || expression[0] !== 'get') {
        scope.error(scanner.position() + ': Expected cue.');
        return this.parent.return(scope, this.rets, this.escs, scanner);
    } else {
        var cue = expression[1];
        var node = scope.create('cue', cue, scanner.position());
        scope.tie(this.rets);
        return this.parent.return(scope.next(), [node], this.escs, scanner);
    }
};

function Block(scope, parent, rets) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    Object.freeze(this);
}

var mutators = {
    '=': true,
    '+': true,
    '-': true,
    '*': true,
    '/': true,
};

var toggles = {
    '!': ['val', 1],
    '?': ['val', 0],
};

var variables = {
    '@': 'loop',
    '#': 'hash',
    '^': 'pick'
};

var switches = {
    '&': 'loop',
    '~': 'rand'
};

Block.prototype.next = function next(type, space, text, scanner) {
    if (type !== 'start') {
        if (text === '(') {
            return expression(this.scope, new ExpressionBlock(this.parent, this.rets, 'walk'))
                .next(type, space, text, scanner);
        } else if (mutators[text]) {
            return expression(this.scope, new SetBlock(this.parent, this.rets, text));
        } else if (toggles[text]) {
            return expression(this.scope, new ToggleBlock(this.parent, this.rets, toggles[text]));
        } else if (variables[text]) {
            return expression(this.scope, new ExpressionBlock(this.parent, this.rets, variables[text]));
        } else if (switches[text]) {
            return new SwitchBlock(this.scope, this.parent, this.rets)
                .start(scanner, null, this.scope.name(), null, switches[text]);
        }
    }
    return new SwitchBlock(this.scope, this.parent, this.rets)
        .start(scanner, null, this.scope.name(), 1, 'walk') // with variable and value, waiting for case to start
        .next(type, space, text, scanner);
};

function SetBlock(parent, rets, op) {
    this.op = op;
    this.parent = parent;
    this.rets = rets;
    Object.freeze(this);
}

SetBlock.prototype.return = function _return(scope, expression, scanner) {
    return new MaybeSetVariable(scope, this.parent, this.rets, this.op, expression);
};

function MaybeSetVariable(scope, parent, rets, op, expression) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.op = op;
    this.expression = expression;
    Object.freeze(this);
}

MaybeSetVariable.prototype.next = function next(type, space, text, scanner) {
    if (type === 'token' && text === '}') {
        return this.set(['val', 1], this.expression, scanner)
            .next(type, space, text, scanner);
    }
    return expression(this.scope, this)
        .next(type, space, text, scanner);
};

MaybeSetVariable.prototype.set = function set(source, target, scanner) {
    var node = this.scope.create('move', null, scanner.position());
    if (this.op === '=') {
        node.source = source;
    } else {
        node.source = [this.op, target, source];
    }
    node.target = target;
    this.scope.tie(this.rets);
    return this.parent.return(this.scope.next(), [node], [], scanner);
};

MaybeSetVariable.prototype.return = function _return(scope, target, scanner) {
    return this.set(this.expression, target, scanner);
};

function ToggleBlock(parent, rets, source) {
    this.parent = parent;
    this.rets = rets;
    this.source = source;
    Object.freeze(this);
}

ToggleBlock.prototype.return = function _return(scope, expression, scanner) {
    var node = scope.create('move', null, scanner.position());
    node.source = this.source;
    node.target = expression;
    scope.tie(this.rets);
    return this.parent.return(scope.next(), [node], [], scanner);
};

function ExpressionBlock(parent, rets, mode) {
    this.parent = parent;
    this.rets = rets;
    this.mode = mode;
    Object.freeze(this);
}

ExpressionBlock.prototype.return = function _return(scope, expression, scanner) {
    return new AfterExpressionBlock(scope, this.parent, this.rets, this.mode, expression);
};

function AfterExpressionBlock(scope, parent, rets, mode, expression) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.mode = mode;
    this.expression = expression;
    Object.freeze(this);
}

AfterExpressionBlock.prototype.next = function next(type, space, text, scanner) {
    if (text === '|') {
        return new SwitchBlock(this.scope, this.parent, this.rets)
            .start(scanner, this.expression, null, 0, this.mode);
    } else if (text === '?') {
        return new SwitchBlock(this.scope, this.parent, this.rets)
            .start(scanner, invertExpression(this.expression), null, 0, this.mode, 2);
    } else if (text === '}') {
        var node = this.scope.create('echo', this.expression, scanner.position());
        this.scope.tie(this.rets);
        return this.parent.return(this.scope.next(), [node], [], scanner)
            .next(type, space, text, scanner);
    } else {
        this.scope.error(scanner.position() + ': Expected "|", "?", or "}" after expression but got ' + tokenName(type, text) + '.');
        return this.parent.return(this.scope, [], [], scanner);
    }
};

function SwitchBlock(scope, parent, rets) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.node = null;
    this.branches = [];
    this.weights = [];
    Object.seal(this);
}

SwitchBlock.prototype.start = function start(scanner, expression, variable, value, mode, min) {
    value = value || 0;
    if (mode === 'loop' && !expression) {
        value = 1;
    }
    expression = expression || ['get', this.scope.name()];
    var node = this.scope.create('switch', expression, scanner.position());
    this.node = node;
    node.variable = variable;
    node.value = value;
    node.mode = mode;
    this.scope.tie(this.rets);
    node.branches = this.branches;
    node.weights = this.weights;
    return new MaybeWeightedCase(this.scope, new Case(this.scope.firstChild(), this, [], this.branches, min || 0));
};

SwitchBlock.prototype.return = function _return(scope, rets, escs, scanner) {
    if (this.node.mode === 'pick') {
        Scope.tie(rets, 'RET');
        rets = [this.node];
        // TODO think about what to do with escs.
    } else {
        this.node.next = 'RET';
    }
    return this.parent.return(this.scope.next(), rets, escs, scanner);
};

function Case(scope, parent, rets, branches, min) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.branches = branches;
    this.min = min;
    Object.freeze(this);
}

Case.prototype.next = function next(type, space, text, scanner) {
    if (text === '|') {
        return new MaybeWeightedCase(this.scope, this);
    } else {
        var scope = this.scope;
        while (this.branches.length < this.min) {
            var node = scope.create('goto', 'RET', scanner.position());
            this.rets.push(node);
            this.branches.push(scope.name());
            scope = scope.next();
        }
        return this.parent.return(scope, this.rets, [], scanner)
            .next(type, space, text, scanner);
    }
};

Case.prototype.case = function _case(args, scanner) {
    this.parent.weights.push(args || ['val', 1]);
    var scope = this.scope.zerothChild();
    var node = scope.create('goto', 'RET', scanner.position());
    this.branches.push(scope.name());
    return new Thread(scope, this, [node], []);
};

Case.prototype.return = function _return(scope, rets, escs, scanner) {
    return new Case(this.scope.next(), this.parent, this.rets.concat(rets, escs), this.branches, this.min);
};

function MaybeWeightedCase(scope, parent) {
    this.scope = scope;
    this.parent = parent;
    Object.freeze(this);
}

MaybeWeightedCase.prototype.next = function next(type, space, text, scanner) {
    if (text === '(') {
        return expression(this.scope, this)
            .next(type, space, text, scanner);
    } else {
        return this.parent.case(null, scanner)
            .next(type, space, text, scanner);
    }
};

MaybeWeightedCase.prototype.return = function _return(scope, args, scanner) {
    return this.parent.case(args, scanner);
};

function Program(scope, parent, rets, escs) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    Object.freeze(this);
}

Program.prototype.next = function next(type, space, text, scanner) {
    if (type === 'stop' || text === '}') {
        return this.parent.return(this.scope, this.rets, this.escs, scanner)
            .next(type, space, text, scanner);
    } else if (text === ',' || type === 'break') {
        return this;
    // istanbul ignore if
    } else if (type === 'error') {
        // Break out of recursive error loops
        return this.parent.return(this.scope, this.rets, this.escs, scanner);
    } else {
        return variable(this.scope, new Assignment(this.scope, this, this.rets, this.escs))
            .next(type, space, text, scanner);
    }
};

Program.prototype.return = function _return(scope, rets, escs, scanner) {
    return new Program(scope, this.parent, rets, escs);
};

function Assignment(scope, parent, rets, escs) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    Object.freeze(this);
}

Assignment.prototype.return = function _return(scope, expression, scanner) {
    // istanbul ignore else
    if (expression[0] === 'get' || expression[0] === 'var') {
        return new ExpectOperator(this.scope, this.parent, this.rets, this.escs, expression);
    } else {
        this.scope.error(scanner.position() + ': Expected variable to assign but got ' + JSON.stringify(expression) + '.');
        return this.parent.return(this.scope, this.rets, this.escs, scanner)
            .next('error', '', '', scanner);
    }
};

function ExpectOperator(scope, parent, rets, escs, left) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    this.left = left;
    Object.freeze(this);
}

ExpectOperator.prototype.next = function next(type, space, text, scanner) {
    // istanbul ignore else
    if (text === '=') {
        return expression(this.scope, new ExpectExpression(this.scope, this.parent, this.rets, this.escs, this.left, text));
    } else {
        this.scope.error(scanner.position() + ': Expected "=" operator but got ' + tokenName(type, text) + '.');
        return this.parent.return(this.scope, this.rets, this.escs, scanner);
    }
};

function ExpectExpression(scope, parent, rets, escs, left, operator) {
    this.scope = scope;
    this.parent = parent;
    this.rets = rets;
    this.escs = escs;
    this.left = left;
    this.operator = operator;
    Object.freeze(this);
}

ExpectExpression.prototype.return = function _return(scope, right, scanner) {
    var node;
    // TODO validate this.left as a valid move target
    this.scope.tie(this.rets);
    node = this.scope.create('move', null, scanner.position());
    node.target = this.left;
    node.source = right;
    return this.parent.return(this.scope.next(), [node], this.escs, scanner);
};

var unary = {
    'not': true,
    '-': true,
    '~': true,
    '#': true
};

var exponential = {
    '**': true // x ** y
};

var multiplicative = {
    '*': true,
    '/': true,
    '%': true,
    'rem': true,
    '~': true,
};

var arithmetic = {
    '+': true,
    '-': true,
};

var comparison = {
    '<': true,
    '<=': true,
    '==': true,
    '<>': true,
    '>=': true,
    '>': true,
    '#': true
};

var intersection = {
    'and': true
};

var union = {
    'or': true
};

var precedence = [ // from low to high
    union,
    intersection,
    comparison,
    arithmetic,
    multiplicative,
    exponential,
];

function expression(scope, parent) {
    for (var i = 0; i < precedence.length; i++) {
        var operators = precedence[i];
        parent = new BinaryExpression(operators, parent);
    }
    return new Unary(scope, parent);
}

function variable(scope, parent) {
    return new GetStaticVariable(scope, parent, [], [], '', true);
}

function label(scope, parent) {
    return new GetStaticVariable(scope, new AfterVariable(parent), [], [], '', true);
}

var inversions = {
    '==': '<>',
    '<>': '==',
    '>': '<=',
    '<': '>=',
    '>=': '<',
    '<=': '>'
};

function invertExpression(expression) {
    if (expression[0] === 'not') {
        return expression[1];
    } else if (inversions[expression[0]]) {
        return [inversions[expression[0]], expression[1], expression[2]];
    } else {
        return ['not', expression];
    }
}

function Open(parent) {
    this.parent = parent;
    Object.seal(this);
}

Open.prototype.return = function _return(scope, expression, scanner) {
    return new Close(scope, this.parent, expression);
};

function Close(scope, parent, expression) {
    this.scope = scope;
    this.parent = parent;
    this.expression = expression;
    Object.seal(this);
}

Close.prototype.next = function next(type, space, text, scanner) {
    // istanbul ignore else
    if (type === 'symbol' && text === ')') {
        return this.parent.return(this.scope, this.expression, scanner);
    } else {
        this.scope.error(scanner.position() + ': Expected parenthetical expression to end with ")" or continue with operator but got ' + tokenName(type, text) + '.');
        return this.parent.return(this.scope, this.expression, scanner);
    }
};

function Value(scope, parent) {
    this.scope = scope;
    this.parent = parent;
    Object.seal(this);
}

Value.prototype.next = function next(type, space, text, scanner) {
    if (type === 'number') {
        return this.parent.return(this.scope, ['val', +text], scanner);
    } else if (text === '(') {
        return expression(this.scope, new Open(this.parent));
    } else if (text === '{') {
        return expression(this.scope, new GetDynamicVariable(this.parent, [''], []));
    // istanbul ignore else
    } else if (type === 'alphanum') {
        return new GetStaticVariable(this.scope, new AfterVariable(this.parent), [], [], text, false);
    } else {
        this.scope.error(scanner.position() + ': Expected expression but got ' + tokenName(type, text) + '.');
        return this.parent.return(this.scope, ['val', 0], scanner)
            .next(type, space, text, scanner);
    }
};

function AfterVariable(parent) {
    this.parent = parent;
    Object.seal(this);
}

AfterVariable.prototype.return = function _return(scope, expression, scanner) {
    return new MaybeCall(scope, this.parent, expression);
};

function MaybeCall(scope, parent, expression) {
    this.scope = scope;
    this.parent = parent;
    this.expression = expression;
    Object.seal(this);
}

MaybeCall.prototype.next = function next(type, space, text, scanner) {
    if (space === '' && text === '(') {
        return new Arguments(this.scope, this.parent, this.expression);
    } else {
        return this.parent.return(this.scope, this.expression, scanner)
            .next(type, space, text, scanner);
    }
};

function Arguments(scope, parent, expression) {
    this.scope = scope;
    this.parent = parent;
    this.args = ['call', expression];
}

Arguments.prototype.next = function next(type, space, text, scanner) {
    if (text === ')') {
        return this.parent.return(this.scope, this.args, scanner);
    } else {
        return expression(this.scope, this)
            .next(type, space, text, scanner);
    }
};

Arguments.prototype.return = function _return(scope, expression, scanner) {
    this.args.push(expression);
    return new MaybeArgument(scope, this);
};

function MaybeArgument(scope, parent) {
    this.scope = scope;
    this.parent = parent;
    Object.seal(this);
}

MaybeArgument.prototype.next = function next(type, space, text, scanner) {
    if (text === ',') {
        return expression(this.scope, this.parent);
    // istanbul ignore else
    } else  if (text === ')') {
        return this.parent.next(type, space, text, scanner);
    } else {
        this.scope.error(scanner.position() + ': Expected "," or ")" to end or argument list but got ' + tokenName(type, text) + '.');
        return this.parent;
    }
};

function Unary(scope, parent) {
    this.scope = scope;
    this.parent = parent;
    Object.seal(this);
}

Unary.prototype.next = function next(type, space, text, scanner) {
    if (unary[text] === true) {
        return new Unary(this.scope,
            new UnaryOperator(this.parent, text));
    } else {
        return new Value(this.scope, this.parent)
            .next(type, space, text, scanner);
    }
};

function UnaryOperator(parent, op) {
    this.parent = parent;
    this.op = op;
}

UnaryOperator.prototype.return = function _return(scope, expression, scanner) {
    return this.parent.return(scope, [this.op, expression], scanner);
};

function MaybeOperator(scope, parent, expression, operators) {
    this.scope = scope;
    this.parent = parent;
    this.expression = expression;
    this.operators = operators;
    Object.seal(this);
}

MaybeOperator.prototype.next = function next(type, space, text, scanner) {
    if (this.operators[text] === true) {
        var parent = new MaybeExpression(this.parent, this.operators);
        parent = new PartialExpression(parent, text, this.expression);
        for (var i = precedence.indexOf(this.operators) + 1; i < precedence.length; i++) {
            parent = new MaybeExpression(parent, precedence[i]);
        }
        return new Unary(this.scope, parent);
    } else {
        return this.parent.return(this.scope, this.expression, scanner)
            .next(type, space, text, scanner);
    }
};

function MaybeExpression(parent, operators) {
    this.parent = parent;
    this.operators = operators;
    Object.seal(this);
}

MaybeExpression.prototype.return = function _return(scope, expression, scanner) {
    return new MaybeOperator(scope, this.parent, expression, this.operators);
};

function PartialExpression(parent, operator, expression) {
    this.parent = parent;
    this.operator = operator;
    this.expression = expression;
}

PartialExpression.prototype.return = function _return(scope, expression, scanner) {
    return this.parent.return(scope, [this.operator, this.expression, expression], scanner);
};

function BinaryExpression(operators, parent) {
    this.parent = parent;
    this.operators = operators;
    Object.seal(this);
}

BinaryExpression.prototype.return = function _return(scope, expression, scanner) {
    return new MaybeOperator(scope, this.parent, expression, this.operators);
};

function GetDynamicVariable(parent, literals, expressions) {
    this.parent = parent;
    this.literals = literals;
    this.expressions = expressions;
    Object.seal(this);
}

GetDynamicVariable.prototype.return = function _return(scope, expression, scanner) {
    return new Expect('token', '}', scope, new ContinueVariable(
        scope,
        this.parent,
        this.literals,
        this.expressions.concat([expression])
    ));
};

function ContinueVariable(scope, parent, literals, expressions) {
    this.scope = scope;
    this.parent = parent;
    this.literals = literals;
    this.expressions = expressions;
    Object.freeze(this);
}

ContinueVariable.prototype.return = function _return() {
    return new GetStaticVariable(this.scope, this.parent, this.literals, this.expressions, '');
};

function GetStaticVariable(scope, parent, literals, expressions, literal, fresh) {
    this.scope = scope;
    this.parent = parent;
    this.literals = literals;
    this.expressions = expressions;
    this.literal = literal;
    this.fresh = fresh;
    Object.seal(this);
}

GetStaticVariable.prototype.next = function next(type, space, text, scanner) {
    if (type !== 'literal' && (space === '' || this.fresh)) {
        this.fresh = false;
        if (text === '{') {
            return expression(this.scope, new GetDynamicVariable(
                this.parent,
                this.literals.concat([this.literal]),
                this.expressions
            ));
        } else if (text === '.') {
            this.literal += text;
            return this;
        } else if (type === 'alphanum' || type === 'number') {
            this.literal += text;
            return this;
        }
    }

    var state;
    if (this.literals.length === 0 && this.expressions.length === 0) {
        // istanbul ignore if
        if (this.literal === '') {
            this.scope.error(scanner.position() + ': Expected name but got ' + tokenName(type, text));
            return this.parent.return(this.scope, [], scanner);
        } else {
            state = this.parent.return(this.scope, ['get', this.literal], scanner);
        }
    } else {
        state = this.parent.return(this.scope, ['var', this.literals.concat([this.literal]), this.expressions], scanner);
    }
    return state.next(type, space, text, scanner);
};

function ThenExpect(expect, text, parent) {
    this.expect = expect;
    this.text = text;
    this.parent = parent;
    Object.freeze(this);
}

ThenExpect.prototype.return = function _return(scope) {
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
    }
    return new Expect(this.expect, this.text, scope, this.parent, args);
};

function Expect(expect, text, scope, parent, args) {
    this.expect = expect;
    this.text = text;
    this.scope = scope;
    this.parent = parent;
    this.args = args;
    Object.freeze(this);
}

Expect.prototype.next = function next(type, space, text, scanner) {
    if (type !== this.expect || text !== this.text) {
        this.scope.error(scanner.position() + ': Expected ' + tokenName(this.expect, this.text) + ' but got ' + tokenName(type, text) + '.');
    }
    return this.parent.return.apply(this.parent, this.args);
};

function tokenName(type, text) {
    // It might not be possible to provoke an error at the beginning of a new
    // block.
    // istanbul ignore if
    if (type === 'start') {
        return 'beginning of a new ' + JSON.stringify(text) + ' block';
    } else if (type === 'stop') {
        return 'to the end of the block';
    } else {
        return JSON.stringify(text);
    }
}
