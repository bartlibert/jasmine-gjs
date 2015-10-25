/* global jasmineImporter */
/* exported run */

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const System = imports.system;

const Config = jasmineImporter.config;
const Options = jasmineImporter.options;
const Timer = jasmineImporter.timer;
const Utils = jasmineImporter.utils;

function run(_jasmine, argv, config={}, timeout=-1) {
    let [files, options] = Options.parseOptions(argv);

    if (options['no-config'])
        config = {};

    if (options.config)
        config = Config.loadConfig(options.config);

    // If an environment is specified, launch a subprocess of Jasmine with that
    // environment
    if (config.environment) {
        let launcher = new Gio.SubprocessLauncher();
        Object.keys(config.environment).forEach((key) => {
            if (config.environment[key] === null)
                launcher.unsetenv(key);
            else
                launcher.setenv(key, config.environment[key], true);
        });

        let args = argv;
        // The subprocess should ignore the config file, since the config file
        // contains the environment key; we will pass everything it needs to
        // know on the command line.
        args.push('--no-config');
        args = Config.configToArgs(config, files.length === 0).concat(args);
        args.unshift(System.programInvocationName);  // argv[0]

        let process = launcher.spawnv(args);
        process.wait(null);
        if (process.get_if_exited())
            return process.get_exit_status();
        return 1;
    }

    if (config.include_paths) {
        Utils.ensureArray(config.include_paths).reverse().forEach((path) => {
            imports.searchPath.unshift(path);
        });
    }

    if (config.options) {
        let [, configOptions] = Options.parseOptions(Utils.ensureArray(config.options));
        // Command-line options should always override config file options
        Object.keys(configOptions).forEach((key) => {
            if (!(key in options))
                options[key] = configOptions[key];
        });
    }

    if (options.exclude || config.exclude) {
        let optionsExclude = options.exclude || [];
        let configExclude = config.exclude? Utils.ensureArray(config.exclude) : [];
        _jasmine.exclusions = configExclude.concat(optionsExclude);
    }

    // Specific tests given on the command line should always override the
    // default tests in the config file
    if (config.spec_files && files.length === 0)
        files = Utils.ensureArray(config.spec_files);

    if (options.version) {
        print('Jasmine', _jasmine.version);
        return 0;
    }

    if (options.junit) {
        const JUnitReporter = jasmineImporter.junitReporter;

        let junitPath = options.junit;
        if (!GLib.path_is_absolute(junitPath) &&
            GLib.getenv('JASMINE_JUNIT_REPORTS_DIR') !== null)
            junitPath = GLib.getenv('JASMINE_JUNIT_REPORTS_DIR') + '/' +
                junitPath;
        let junitFile = Gio.File.new_for_commandline_arg(junitPath);

        // Since people might want their report dir structure to mirror
        // their test dir structure, we shall be kind and try to create any
        // report directories that don't exist.
        try {
            junitFile.get_parent().make_directory_with_parents(null);
        } catch (e if e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
            // ignore error if directory already exists
        }

        let rawStream = junitFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
        let junitStream = new Gio.DataOutputStream({
            base_stream: rawStream,
        });

        let junitReporter = new JUnitReporter.JUnitReporter({
            timerFactory: Timer.createDefaultTimer,
            print: function (str) {
                junitStream.put_string(str, null);
            },
        });
        junitReporter.connect('complete', () => junitStream.close(null));
        _jasmine.addReporter(junitReporter);
    }

    let timeoutId;
    let reporterOptions = {
        show_colors: options.color,
        timerFactory: Timer.createDefaultTimer,
    };

    let reporter;
    if (options.verbose) {
        const VerboseReporter = jasmineImporter.verboseReporter;
        reporter = new VerboseReporter.VerboseReporter(reporterOptions);
    } else if (options.tap) {
        const TapReporter = jasmineImporter.tapReporter;
        reporter = new TapReporter.TapReporter(reporterOptions);
    } else {
        const ConsoleReporter = jasmineImporter.consoleReporter;
        reporter = new ConsoleReporter.DefaultReporter(reporterOptions);
    }
    reporter.connect('started', () => Mainloop.source_remove(timeoutId));
    reporter.connect('complete', (success) => {
        if (!success)
            System.exit(1);
        Mainloop.quit('jasmine');
    });
    _jasmine.addReporter(reporter);

    // This works around a limitation in GJS 1.40 where exceptions occurring
    // during module import are swallowed.
    if (timeout !== -1) {
        timeoutId = Mainloop.timeout_add_seconds(timeout, function () {
            if (options.tap)
                print('Bail out! Test suite failed to start within 10 seconds');
            else
                printerr('Test suite failed to start within 10 seconds');
            System.exit(1);
        });
    }

    // This should start after the main loop starts, otherwise we will hit
    // Mainloop.run() only after several tests have already run. For consistency
    // we should guarantee that there is a main loop running during the tests.
    Mainloop.idle_add(function () {
        try {
            _jasmine.execute(files);
        } catch (e) {
            if (options.tap) {
                // "Bail out!" has a special meaning to TAP harnesses
                print('Bail out! Exception occurred inside Jasmine:', e);
            } else {
                printerr('Exception occurred inside Jasmine:');
                printerr(e);
                printerr(e.stack);
            }
            System.exit(1);
        }
        return GLib.SOURCE_REMOVE;
    });

    // _jasmine.execute() queues up all the tests and runs them asynchronously.
    Mainloop.run('jasmine');
    return 0;
}
