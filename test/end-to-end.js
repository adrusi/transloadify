import OutputCtl from './OutputCtl'
import TransloaditClient from 'transloadit'
import fs from 'fs'
import path from 'path'
import Q from 'q'
import rimraf from 'rimraf'
import { expect } from 'chai'
import { zip } from '../src/helpers'
const templates = require('../src/templates')

const tmpDir = '/tmp'

const authKey = process.env.TRANSLOADIT_KEY
const authSecret = process.env.TRANSLOADIT_SECRET

if (!authKey || !authSecret) {
  console.error('Please provide environment variables TRANSLOADIT_KEY and TRANSLOADIT_SECRET to run tests')
  process.exit()
}

let testno = 0

function testCase(cb) {
  return () => {
    let dirname = path.join(tmpDir, `transloadify_test_${testno++}`) 
    let client = new TransloaditClient({ authKey, authSecret })
    return Q.nfcall(fs.mkdir, dirname)
      .then(() => {
        process.chdir(dirname)
        return cb(client)
      })
      .fin(() => Q.nfcall(rimraf, dirname))
  }
}

describe("End-to-end", function () {
  this.timeout(100000)

  describe("templates", function () {
    describe("create", function () {
      it("should create templates", testCase(client => {
        let executions = [1, 2, 3, 4, 5].map(n => {
          let output = new OutputCtl()
          // Make a file with the template contents
          return Q.nfcall(fs.writeFile, `${n}.json`, JSON.stringify({ testno: n }))
            // run the test subject
            .then(() => templates.create(output, client, { name: `test_${n}`, file: `${n}.json` }))
            // ignore the promise result, just look at the output the user would
            // see
            .then(() => output.get())
        })
        
        return Q.all(executions).then(results => {
          return Q.all(results.map(result => {
            return Q.fcall(() => {
              // Verify that the output looks as expected
              expect(result).to.have.lengthOf(1)
              expect(result).to.have.deep.property('[0].type').that.equals('print')
              expect(result).to.have.deep.property('[0].msg').that.equals(result[0].json.id)
            }).fin(() => {
              // delete these test templates from the server, but don't fail the
              // test if it doesn't work
              return Q.nfcall(client.deleteTemplate.bind(client), result[0].json.id)
                .fail(() => {})
            })
          }))
        })
      }))
    })

    describe("get", function () {
      it("should get templates", testCase(client => {
        // get some valid template IDs to request
        let templateRequests = Q.nfcall(client.listTemplates.bind(client), { pagesize: 5 })
          .then(response => response.items)
          .then(templates => {
            if (templates.length === 0) throw new Error("account has no templates to fetch")
            return templates
          })

        let sdkResults = templateRequests.then(ts => {
          return Q.all(ts.map(template => {
            return Q.nfcall(client.getTemplate.bind(client), template.id)
          }))
        })

        let transloadifyResults = templateRequests.then(ts => {
          return Q.all(ts.map(template => {
            let output = new OutputCtl()
            return templates.get(output, client, { templates: [template.id] })
              .then(() => output.get())
          }))
        })

        return Q.spread([sdkResults, transloadifyResults], (expectations, actuals) => {
          return Q.all(zip(expectations, actuals).map(([expectation, actual]) => {
            expect(actual).to.have.lengthOf(1)
            expect(actual).to.have.deep.property('[0].type').that.equals('print')
            expect(actual).to.have.deep.property('[0].json').that.deep.equals(expectation)
          }))
        })
      }))

      it("should return templates in the order specified", testCase(client => {
        let templateRequests = Q.nfcall(client.listTemplates.bind(client), { pagesize: 5 })
          .then(response => response.items.sort(() => 2 * Math.floor(Math.random() * 2) - 1))
          .then(templates => {
            if (templates.length === 0) throw new Error("account has no templates to fetch")
            return templates
          })

        let idsPromise = templateRequests
          .then(templates => templates.map(template => template.id))
        
        let resultsPromise = idsPromise.then(ids => {
          let output = new OutputCtl()
          return templates.get(output, client, { templates: ids })
            .then(() => output.get())
        })

        return Q.spread([resultsPromise, idsPromise], (results, ids) => {
          expect(results).to.have.lengthOf(ids.length)
          return Q.all(zip(results, ids).map(([result, id]) => {
            expect(result).to.have.property('type').that.equals('print')
            expect(result).to.have.deep.property('json.id').that.equals(id)
          }))
        })
      }))
    })

    describe("modify", function () {
      let templateId;

      before(function () {
        let client = new TransloaditClient({ authKey, authSecret })
        return Q.nfcall(client.createTemplate.bind(client), {
          name: "originalName",
          template: JSON.stringify({ stage: 0 })
        }).then(response => { templateId = response.id })
      })

      it("should modify but not rename the template", testCase(client => {
        let filePromise = Q.nfcall(fs.writeFile, "template.json", JSON.stringify({ stage: 1 }))

        let resultPromise = filePromise.then(() => {
          let output = new OutputCtl()
          return templates.modify(output, client, {
            template: templateId, 
            file: "template.json"
          }).then(() => output.get())
        })
        
        return resultPromise.then(result => {
          expect(result).to.have.lengthOf(0)
          return Q.delay(2000).then(() => Q.nfcall(client.getTemplate.bind(client), templateId))
            .then(template => {
              expect(template).to.have.property('name').that.equals('originalName')
              expect(template).to.have.property('content').that.deep.equals({ stage: 1 })
            })
        })
      }))

      it("should not modify but rename the template", testCase(client => {
        let filePromise = Q.nfcall(fs.writeFile, "template.json", "")

        let resultPromise = filePromise.then(() => {
          let output = new OutputCtl()
          return templates.modify(output, client, {
            template: templateId, 
            name: "newName",
            file: "template.json"
          }).then(() => output.get())
        })
        
        return resultPromise.then(result => {
          expect(result).to.have.lengthOf(0)
          return Q.delay(2000).then(() => Q.nfcall(client.getTemplate.bind(client), templateId))
            .then(template => {
              expect(template).to.have.property('name').that.equals('newName')
              expect(template).to.have.property('content').that.deep.equals({ stage: 1 })
            })
        })
      }))

      it("should modify and rename the template", testCase(client => {
        let filePromise = Q.nfcall(fs.writeFile, "template.json", JSON.stringify({ stage: 2 }))

        let resultPromise = filePromise.then(() => {
          let output = new OutputCtl()
          return templates.modify(output, client, {
            template: templateId, 
            name: "newerName",
            file: "template.json"
          }).then(() => output.get())
        })
        
        return resultPromise.then(result => {
          expect(result).to.have.lengthOf(0)
          return Q.delay(2000).then(() => Q.nfcall(client.getTemplate.bind(client), templateId))
            .then(template => {
              expect(template).to.have.property('name').that.equals('newerName')
              expect(template).to.have.property('content').that.deep.equals({ stage: 2 })
            })
        })
      }))

      after(function () {
        let client = new TransloaditClient({ authKey, authSecret })
        return Q.nfcall(client.deleteTemplate.bind(client), templateId)
      })
    })

    describe("delete", function () {
      it("should delete templates", testCase(client => {
        let templateIdsPromise = Q.all([1, 2, 3, 4, 5].map(n => {
          return Q.nfcall(client.createTemplate.bind(client), {
            name: `delete_test_${n}`,
            template: JSON.stringify({ n })
          }).then(response => response.id)
        }))

        let resultPromise = templateIdsPromise.then(ids => {
          let output = new OutputCtl()
          return templates.delete(output, client, { templates: ids })
            .then(() => output.get())
        })

        return Q.spread([resultPromise, templateIdsPromise], (result, ids) => {
          expect(result).to.have.lengthOf(0)
          return Q.all(ids.map(id => {
            return Q.nfcall(client.getTemplate.bind(client), id)
              .then(response => { expect(response).to.not.exist })
              .fail(err => {
                if (err.error !== "TEMPLATE_NOT_FOUND") throw err
              })
          }))
        })
      }))
    })

    describe("sync", function () {
      it("should handle directories recursively", testCase(client => {
        let templateIdsPromise = Q.nfcall(client.listTemplates.bind(client), { pagesize: 5 })
          .then(response => response.items.map(item => ({ id: item.id, name: item.name })))

        let filesPromise = templateIdsPromise.then(ids => {
          let dirname = "d";
          let promise = Q.fcall(() => {})
          
          return Q.all(ids.map(({id, name}) => {
            return (promise = promise.then(() => {
              let fname = path.join(dirname, `${name}.json`)
              return Q.nfcall(fs.mkdir, dirname)
                .then(() => Q.nfcall(fs.writeFile, fname, `{"transloadit_template_id":"${id}"}`))
                .then(() => { dirname = path.join(dirname, "d") })
                .then(() => fname)
            }))
          }))
        })

        let resultPromise = filesPromise.then(files => {
          let output = new OutputCtl()
          return templates.sync(output, client, { recursive: true, files: ["d"] })
            .then(() => output.get())
        })

        return Q.spread([resultPromise, templateIdsPromise, filesPromise], (result, ids, files) => {
          expect(result).to.have.lengthOf(0)
          let fileContentsPromise = Q.all(files.map(file => Q.nfcall(fs.readFile, file).then(JSON.parse)))
          return fileContentsPromise.then(contents => {
            return Q.all(zip(contents, ids).map(([content, id]) => {
              expect(content).to.have.property('transloadit_template_id').that.equals(id.id)
              expect(content).to.have.property('steps')
            }))
          })
        })
      }))
    })
  })
})