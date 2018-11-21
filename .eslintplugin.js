module.exports = {
  processors: {
    // assign to the file extension you want (.js, .jsx, .html, etc.)
    ".js": {
        // takes text of the file and filename
        preprocess: function(text, filename) {
            if (filename.indexOf('/resource/translators/') < 0) return [text];

            const translator = text.match(/^([\s\S]+?})(\n\n[\s\S]+)/);
            return [`const zotero_translator_header = ${translator[1]};${translator[2]}`];
        },

        // takes a Message[][] and filename
        postprocess: function(messages, filename) {
            // `messages` argument contains two-dimensional array of Message objects
            // where each top-level array item contains array of lint messages related
            // to the text that was returned in array from preprocess() method

            // you need to return a one-dimensional array of the messages you want to keep
            return [].concat.apply([], messages);
        },

        supportsAutofix: false
    }
  }
};

