'use strict';

var Path = require('./path');
var story = require('./story');

exports.start = start;

function start() {
    return new Knot(['start', 0], new Start());
}

function Start() {
    this.type = 'start';
    this.parent = null;
    this.prev = null;
}

Start.prototype.return = function _return(prev) {
    return new End(this, prev);
};

function End(parent, prev) {
    this.type = 'end';
    this.parent = parent;
    this.prev = prev;
}

// istanbul ignore next
End.prototype.next = function next(type, text) {
    throw new Error('nodes beyond root ' + type + ' ' + JSON.stringify(text));
};

function Knot(path, parent, prev) {
    this.type = 'knot';
    this.path = path;
    this.parent = parent;
    this.prev = prev;
}

Knot.prototype.next = function next(type, text) {
    if (type === 'text') {
        return new Knot(Path.next(this.path), this.parent, new story.Text(this.path, text, this.prev));
    } else if (type === 'stop') {
        return this.parent.return(this.prev);
    } else if (type === 'start' && text === '') {
        return new Knot(this.path, this, this.prev);
    } else if (type === 'start' && text === '+') {
        return new Option(this.path, this, this.prev, []);
    } else if (type === 'break') {
        return this;
    } else if (type === 'token' && text === '=') {
        return new Label(this.path, this.parent, this.prev);
    } else if (type === 'token' && text === '->') {
        return new Goto(this.path, this.parent, this.prev);
    // istanbul ignore else
    } else {
        throw new Error('no support for type in knot state: ' + type + ' ' + JSON.stringify(text));
    }
};

Knot.prototype.return = function _return(prev) {
    return new Knot(Path.next(prev.path), this.parent, prev);
};

function Option(path, parent, prev, ends) {
    this.type = 'option';
    this.path = path;
    this.parent = parent;
    this.prev = prev;
    this.ends = ends;
    this.option = null;
}

Option.prototype.next = function next(type, text) {
    // istanbul ignore else
    if (type === 'text') {
        this.option = new story.Option(this.path, text, this.prev, this.ends);
        return new Knot(Path.firstChild(this.path), this, this.option);
    } else {
        throw new Error('TODO'); // TODO
    }
};

Option.prototype.return = function _return(prev) {
    return new MaybeOption(Path.next(this.path), this.parent, this.option, this.ends.concat([prev]));
};

function MaybeOption(path, parent, prev, ends) {
    this.type = 'maybe-option';
    this.parent = parent;
    this.prev = prev;
    this.ends = ends;
    this.path = path;
}

MaybeOption.prototype.next = function next(type, text) {
    if (type === 'start' && text === '+') {
        var returnKnot = new Knot(Path.next(this.path), this, this.prev);
        return new Option(this.path, returnKnot, this.prev, this.ends);
    } else {
        var options = new story.Options(this.path, this.ends, this.prev);
        return this.parent.return(options).next(type, text);
    }
};

MaybeOption.prototype.return = function _return(prev) {
    return new Knot(Path.next(this.path), this.parent, prev);
};

function Label(path, parent, prev) {
    this.type = 'label';
    this.path = path;
    this.parent = parent;
    this.prev = prev;
}

Label.prototype.next = function next(type, text) {
    if (type === 'text') {
        return readIdentifier(text, this);
    } else if (type === 'identifier') {
        return new Knot([text, 0], this.parent, this.prev);
    } else {
        throw new Error('expected label after =');
    }
};

function Goto(path, parent, prev) {
    this.type = 'goto';
    this.path = path;
    this.parent = parent;
    this.prev = prev;
}

Goto.prototype.next = function next(type, text) {
    if (type === 'text') {
        return readIdentifier(text, this);
    } else if (type === 'identifier') {
        return new Knot(Path.next(this.path), this.parent, new story.Goto(this.path, text, this.prev));
    } else {
        throw new Error('expected label after ->');
    }
};

function readIdentifier(text, node) {
    var i = 0, c;
    // eat leading whitespace
    while (c = text[i], i < text.length && (c === ' ' || c === '\t')) {
        i++;
    }
    var start = i;
    while (c = text[i], i < text.length && c !== ' ' && c !== '\t') {
        i++;
    }
    var end = i;
    while (c = text[i], i < text.length && (c === ' ' || c === '\t')) {
        i++;
    }
    if (start < end) {
        node = node.next('identifier', text.slice(start, end));
    }
    if (end < text.length) {
        node = node.next('text', text.slice(end + 1));
    }
    return node;
}
