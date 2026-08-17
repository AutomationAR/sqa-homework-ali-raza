/**
 * promptfoo custom provider.
 *
 * promptfoo's normal job is to call a model and grade the output. Here the thing
 * under evaluation is our own grader, so the "provider" IS the grader: it takes
 * a {{question}}/{{response}} pair from the dataset and emits a verdict, which
 * the config then asserts on. This is what makes the golden dataset a regression
 * test for the rubric itself.
 *
 * Output is returned as a JSON string so the `javascript` assertions in
 * promptfooconfig.yaml can JSON.parse it unambiguously, rather than relying on
 * promptfoo's object-vs-string coercion.
 */

'use strict';

const path = require('path');
const { gradeRelevance } = require(path.join(__dirname, '..', 'relevance-grader.js'));

class RelevanceGraderProvider {
  constructor(options = {}) {
    this.providerId = options.id || 'relevance-grader';
    this.config = options.config || {};
  }

  id() {
    return this.providerId;
  }

  /**
   * @param {string} _prompt   rendered prompt (unused: we grade the raw vars)
   * @param {{vars?: Record<string, string>}} context
   */
  async callApi(_prompt, context) {
    const vars = (context && context.vars) || {};
    const question = vars.question || '';
    const response = vars.response || '';

    try {
      const verdict = await gradeRelevance(question, response);
      return { output: JSON.stringify(verdict) };
    } catch (err) {
      return { error: `grader threw: ${err && err.message ? err.message : String(err)}` };
    }
  }
}

module.exports = RelevanceGraderProvider;
