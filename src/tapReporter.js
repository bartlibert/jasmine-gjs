// Reporter that outputs according to the Test Anything Protocol
// See http://testanything.org/tap-specification.html

/* global jasmineImporter */
/* exported TapReporter */

const Format = imports.format;
const Lang = imports.lang;

const ConsoleReporter = jasmineImporter.consoleReporter;

String.prototype.format = Format.format;

const TapReporter = new Lang.Class({
    Name: 'TapReporter',
    Extends: ConsoleReporter.ConsoleReporter,

    jasmineStarted: function (info) {
        this.parent();
        this._print('1..%d\n'.format(info.totalSpecsDefined));
    },

    jasmineDone: function () {
        this._failedSuites.forEach((failure) => {
            failure.failedExpectations.forEach((result) => {
                this._print('not ok - An error was thrown in an afterAll(): %s\n'.format(result.message));
            });
        });
        this.parent();
    },

    suiteStarted: function (result) {
        this.parent(result);
        this._print('# Suite started: %s\n'.format(result.fullName));
    },

    suiteDone: function (result) {
        this.parent(result);
        if (result.status === 'disabled') {
            this._print('# Suite was disabled: %s\n'.format(result.fullName));
        } else {
            let failures = result.failedExpectations.length;
            this._print('# Suite finished with %d %s: %s\n'.format(failures,
                failures === 1? 'failure' : 'failures', result.fullName));
        }
    },

    specDone: function (result) {
        this.parent(result);

        if (result.status === 'failed')
            this._print('not ok');
        else
            this._print('ok');
        this._print(' %d - %s'.format(this._specCount, result.fullName));
        if (result.status === 'pending' || result.status === 'disabled') {
            let reason = result.pendingReason || result.status;
            this._print(' # SKIP ' + reason);
        }
        if (result.status === 'failed' && result.failedExpectations) {
            let messages = result.failedExpectations.map((r) => _removeNewlines(r.message)).join(' ');
            this._print(' (%s)'.format(messages));
        }
        this._print('\n');

        // Print additional diagnostic info on failure
        if (result.status === 'failed' && result.failedExpectations) {
            result.failedExpectations.forEach((failedExpectation) => {
                this._print('# Message: %s\n'.format(_removeNewlines(failedExpectation.message)));
                this._print('# Stack:\n');
                let stackTrace = this.filterStack(failedExpectation.stack).trim();
                this._print(stackTrace.split('\n').map((str) => '#   ' + str).join('\n'));
                this._print('\n');
            });
        }
    },
});

function _removeNewlines(str) {
    let allNewlines = /\n/g;
    return str.replace(allNewlines, '\\n');
}
