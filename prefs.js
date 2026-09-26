import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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
            title: _('Show mode button'),
            subtitle: _('Pick the start mode while off, show or hide the window while running'),
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
