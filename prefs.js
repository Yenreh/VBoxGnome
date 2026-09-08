import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const START_MODES = ['window', 'headless'];
const STOP_MODES = ['acpipowerbutton', 'savestate', 'poweroff'];

function bindCombo(settings, key, row, values) {
    row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
    row.connect('notify::selected', () => settings.set_string(key, values[row.selected]));
    settings.connect(`changed::${key}`, () => {
        const index = values.indexOf(settings.get_string(key));
        if (index >= 0 && index !== row.selected)
            row.selected = index;
    });
}

export default class VBoxGnomePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const behaviour = new Adw.PreferencesGroup({title: _('Power')});
        page.add(behaviour);

        const startRow = new Adw.ComboRow({
            title: _('Start mode'),
            subtitle: _('Both modes allow showing or hiding the window later'),
            model: new Gtk.StringList({strings: [_('Window'), _('Headless')]}),
        });
        bindCombo(settings, 'start-mode', startRow, START_MODES);
        behaviour.add(startRow);

        const stopRow = new Adw.ComboRow({
            title: _('Stop action'),
            subtitle: _('Used when a machine is switched off'),
            model: new Gtk.StringList({
                strings: [_('ACPI shutdown'), _('Save state'), _('Power off')],
            }),
        });
        bindCombo(settings, 'stop-mode', stopRow, STOP_MODES);
        behaviour.add(stopRow);

        const appearance = new Adw.PreferencesGroup({title: _('Appearance')});
        page.add(appearance);

        const countRow = new Adw.SwitchRow({
            title: _('Show running count'),
            subtitle: _('Display the number of running machines in the panel'),
        });
        settings.bind('show-running-count', countRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(countRow);

        const windowRow = new Adw.SwitchRow({
            title: _('Show window toggle'),
            subtitle: _('Add a Show window / Hide window entry for running machines'),
        });
        settings.bind('show-window-toggle', windowRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(windowRow);

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('Seconds between state checks'),
            adjustment: new Gtk.Adjustment({
                lower: 2,
                upper: 300,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        settings.bind('refresh-interval', intervalRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(intervalRow);
    }
}
