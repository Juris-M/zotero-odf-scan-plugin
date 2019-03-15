function fixMessage(m, offset) {
  if (offset) {
    m.line += offset.lines;
    if (typeof m.endLine === 'number') m.endLine += offset.lines;

    if (m.fix) m.fix.range = m.fix.range.map(c => c + offset.chars);
  }

  return m;
}

module.exports = {
  processors: {
    // assign to the file extension you want (.js, .jsx, .html, etc.)
    ".js": {
        // takes text of the file and filename
        preprocess: function(text, filename) {
            if (!this.offset) this.offset = {}

            if (filename.indexOf('/resource/translators/') < 0) return [text];

            const translator = text.match(/^([\s\S]+?\r?\n}(\r?\n)+)([\s\S]+)/);
            this.offset[filename] = {
              lines: translator[1].split('\n').length - 1,
              chars: translator[1].length,
            }
            return [translator[3]];
        },

        // takes a Message[][] and filename
        postprocess: function(messages, filename) {
            // `messages` argument contains two-dimensional array of Message objects
            // where each top-level array item contains array of lint messages related
            // to the text that was returned in array from preprocess() method

            // you need to return a one-dimensional array of the messages you want to keep
            return messages[0].map(m => fixMessage(m, this.offset[filename]));
        },

        supportsAutofix: true
    }
  }
};

