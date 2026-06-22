const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logDir) {
        this.logDir = logDir;
        this.startTime = new Date();
        this.filename = this._formatDatetime(this.startTime) + '.log';
        this.filepath = path.join(logDir, this.filename);
        this.stats = { total: 0, dnsChecked: 0, whoisChecked: 0, success: 0, failed: 0 };

        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        this._stream = fs.createWriteStream(this.filepath, { flags: 'a' });
    }

    _formatDatetime(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    }

    _timestamp() {
        return new Date().toISOString();
    }

    _write(level, msg) {
        const line = `[${this._timestamp()}] [${level}] ${msg}`;
        this._stream.write(line + '\n');
        console.log(line);
    }

    info(msg) {
        this._write('INFO', msg);
    }

    error(msg) {
        this._write('ERROR', msg);
    }

    finish() {
        const endTime = new Date();
        const duration = ((endTime - this.startTime) / 1000).toFixed(1);

        this.info('--- Scan Complete ---');
        this.info(`Start: ${this.startTime.toISOString()}`);
        this.info(`End: ${endTime.toISOString()}`);
        this.info(`Duration: ${duration}s`);
        this.info(`Total domains: ${this.stats.total}`);
        this.info(`DNS checked: ${this.stats.dnsChecked}`);
        this.info(`WHOIS checked: ${this.stats.whoisChecked}`);
        this.info(`Success: ${this.stats.success}`);
        this.info(`Failed: ${this.stats.failed}`);

        this._stream.end();
        return { filename: this.filename, startTime: this.startTime.toISOString(), endTime: endTime.toISOString(), duration, stats: this.stats };
    }
}

module.exports = { Logger };
