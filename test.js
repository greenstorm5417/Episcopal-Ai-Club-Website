const ClinicDoctor = require('@clinic/doctor')
const doctor = new ClinicDoctor()

doctor.collect(['node', './server.js'], function (err, filepath) {
  if (err) throw err

  doctor.visualize(filepath, filepath + '.html', function (err) {
    if (err) throw err
  });
})