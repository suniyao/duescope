function initTracker() {
  console.log("Gradescope Deadline Tracker: Initializing...");
  // Prevent multiple injections
  if (document.getElementById('gs-tracker-toggle')) {
    console.log("Gradescope Deadline Tracker: Already injected.");
    return;
  }

  // Create the toggle button
  var toggleBtn = document.createElement('button');
  toggleBtn.id = 'gs-tracker-toggle';
  toggleBtn.innerHTML = '📅';
  toggleBtn.title = 'Show All Deadlines';
  document.body.appendChild(toggleBtn);
  console.log("Gradescope Deadline Tracker: Button added to body.");

  // Create the sidebar
  var sidebar = document.createElement('div');
  sidebar.id = 'gs-deadline-tracker';
  sidebar.innerHTML = 
    '<div id="gs-tracker-header">' +
      '<span>My Deadlines</span>' +
      '<button id="gs-tracker-close">&times;</button>' +
    '</div>' +
    '<div id="gs-tracker-content">' +
      '<div class="gs-loading">Click "Load Deadlines" to fetch your assignments.</div>' +
    '</div>' +
    '<div style="padding: 15px; background: white; border-top: 1px solid #ddd;">' +
      '<button id="gs-tracker-refresh">Load Deadlines</button>' +
    '</div>';
  document.body.appendChild(sidebar);

  // Toggle logic
  toggleBtn.addEventListener('click', function() {
    sidebar.classList.add('open');
  });

  document.getElementById('gs-tracker-close').addEventListener('click', function() {
    sidebar.classList.remove('open');
  });

  // Define the fetch function so we can call it on click AND on load
  async function fetchDeadlines() {
    var contentDiv = document.getElementById('gs-tracker-content');
    contentDiv.innerHTML = '<div class="gs-loading">Fetching courses...</div>';
    
    try {
      // 1. Fetch the dashboard to get course links
      var dashboardRes = await fetch('https://www.gradescope.com/account');
      var dashboardText = await dashboardRes.text();
      var parser = new DOMParser();
      var dashboardDoc = parser.parseFromString(dashboardText, 'text/html');
      
      // Find all course links (Gradescope usually uses .courseBox for course links)
      var courseElements = dashboardDoc.querySelectorAll('a.courseBox');
      var courses = [];
      for (var i = 0; i < courseElements.length; i++) {
        var el = courseElements[i];
        var shortNameEl = el.querySelector('.courseBox--shortname');
        var nameEl = el.querySelector('.courseBox--name');
        courses.push({
          name: (shortNameEl ? shortNameEl.innerText : (nameEl ? nameEl.innerText : 'Unknown Course')),
          url: el.href
        });
      }

      if (courses.length === 0) {
        contentDiv.innerHTML = '<div class="gs-loading">No courses found. Make sure you are logged in.</div>';
        return;
      }

      contentDiv.innerHTML = '<div class="gs-loading">Fetching assignments for ' + courses.length + ' courses...</div>';
      
      var allAssignments = [];

      // 2. Fetch each course page to get assignments
      for (var i = 0; i < courses.length; i++) {
        var course = courses[i];
        try {
          // Ensure we are fetching the correct URL
          var courseUrl = course.url;
          if (courseUrl && courseUrl.startsWith('/')) {
            courseUrl = 'https://www.gradescope.com' + courseUrl;
          }
          
          var courseRes = await fetch(courseUrl);
          var courseText = await courseRes.text();
          var courseDoc = parser.parseFromString(courseText, 'text/html');
          
          // Gradescope assignments are usually in a table. 
          // We look for rows that might contain assignments.
          var assignmentRows = courseDoc.querySelectorAll('tr');
          
          assignmentRows.forEach(function(row) {
            // The title is usually in a table header (th) or data cell (td)
            var titleEl = row.querySelector('th, td');
            if (!titleEl) return;
            
            // The due date is usually in a specific div or time element
            // We need to be careful not to grab the release date. The due date is usually the last time element or inside .submissionTimeChart--dueDate
            var dateEl = row.querySelector('.submissionTimeChart--dueDate');
            if (!dateEl) {
              // Fallback: get all time elements and pick the last one (which is usually the due date)
              var timeEls = row.querySelectorAll('time');
              if (timeEls.length > 0) {
                dateEl = timeEls[timeEls.length - 1];
              }
            }
            
            // Check if it's already submitted
            var statusEl = row.querySelector('.submissionStatus--text, .submissionStatus--score, .submissionStatus--warning');
            var isSubmitted = false;
            if (statusEl) {
              var statusText = statusEl.innerText.toLowerCase();
              if (statusText.includes('submitted') || statusText.includes('graded') || statusText.includes('/')) {
                isSubmitted = true;
              }
            }
            
            if (dateEl && !isSubmitted) {
              // Clean up the title text (remove "No Submission" or other status text that might be inside the same cell)
              var title = titleEl.innerText.split('\n')[0].trim();
              
              // Get the text, but if it's inside a complex element, try to get just the main date part
              var dateText = '';
              var actualTimeEl = dateEl.querySelector('time');
              if (actualTimeEl) {
                // If there's a <time> element, it usually has a datetime attribute which is a standard ISO string
                var datetimeAttr = actualTimeEl.getAttribute('datetime');
                if (datetimeAttr) {
                  dateText = datetimeAttr; // Use the standard ISO string for parsing
                } else {
                  dateText = actualTimeEl.innerText.trim();
                }
              } else {
                dateText = dateEl.innerText.trim();
              }
              
              // Sometimes the date text includes "Late Due Date: ...", we just want the first part
              if (dateText.includes('\n')) {
                dateText = dateText.split('\n')[0].trim();
              }
              
              // Basic filter to avoid header rows and empty dates
              if (title !== 'Name' && title !== 'Assignment' && dateText && !dateText.toLowerCase().includes('due date')) {
                // Try to find the link to the assignment
                var linkUrl = '';
                var linkEl = row.querySelector('a[aria-label^="View"]');
                var btnEl = row.querySelector('button.js-submitAssignment');
                
                if (linkEl) {
                  linkUrl = linkEl.href;
                } else if (btnEl && btnEl.getAttribute('data-post-url')) {
                  var postUrl = btnEl.getAttribute('data-post-url');
                  linkUrl = 'https://www.gradescope.com' + postUrl.split('/submissions')[0];
                } else {
                  // Fallback: just grab the first link in the row
                  var anyLink = row.querySelector('a');
                  if (anyLink) {
                    linkUrl = anyLink.href;
                  }
                }

                // If we grabbed the ISO string, we still want to display the human-readable version
                var displayDateStr = actualTimeEl ? actualTimeEl.innerText.trim() : dateText;
                if (displayDateStr.includes('\n')) {
                  displayDateStr = displayDateStr.split('\n')[0].trim();
                }

                allAssignments.push({
                  course: course.name,
                  title: title,
                  dueDateStr: displayDateStr,
                  timestamp: parseGradescopeDate(dateText),
                  url: linkUrl
                });
              }
            }
          });
        } catch (err) {
          console.error('Failed to fetch course ' + course.name, err);
        }
      }

      // 3. Sort and display
      var now = new Date().getTime();
      
      // Sort by timestamp across ALL courses
      // 1. Future assignments (closest first)
      // 2. Past assignments (most recent first, so just-due is above due-a-month-ago)
      // 3. Unparseable dates (0) go to the end
      allAssignments.sort(function(a, b) {
        if (a.timestamp === 0) return 1;
        if (b.timestamp === 0) return -1;
        
        var aIsFuture = a.timestamp >= now;
        var bIsFuture = b.timestamp >= now;
        
        if (aIsFuture && bIsFuture) {
          // Both in future: closest first (ascending)
          if (a.timestamp === b.timestamp) {
             return a.title.localeCompare(b.title); // Break ties alphabetically
          }
          return a.timestamp - b.timestamp;
        } else if (!aIsFuture && !bIsFuture) {
          // Both in past: most recent first (descending)
          if (a.timestamp === b.timestamp) {
             return a.title.localeCompare(b.title); // Break ties alphabetically
          }
          return b.timestamp - a.timestamp;
        } else {
          // One future, one past: future comes first
          return aIsFuture ? -1 : 1;
        }
      });
      
      // Filter out past assignments (optional, but good for a deadline tracker)
      var upcomingAssignments = allAssignments.filter(function(a) { 
        // Only show assignments due in the future, or unparseable ones just in case
        // Add a 30 day buffer so things due recently don't immediately disappear
        return a.timestamp > (now - 24 * 60 * 60 * 1000) || a.timestamp === 0; 
      });

      if (upcomingAssignments.length === 0) {
        contentDiv.innerHTML = '<div class="gs-loading">No upcoming deadlines found! 🎉</div>';
        return;
      }

      contentDiv.innerHTML = '';
      upcomingAssignments.forEach(function(assignment) {
        // Mark as urgent if due in less than 48 hours
        var isUrgent = (assignment.timestamp !== 0 && (assignment.timestamp - now) < 48 * 60 * 60 * 1000); 
        
        var el = document.createElement('div');
        el.className = 'gs-assignment ' + (isUrgent ? 'urgent' : '');
        
        var titleHtml = assignment.url 
          ? '<a href="' + assignment.url + '" target="_blank" style="color: inherit; text-decoration: underline;">' + assignment.title + '</a>'
          : assignment.title;

        el.innerHTML = 
          '<div class="gs-course-name">' + assignment.course + '</div>' +
          '<div class="gs-assignment-name">' + titleHtml + '</div>' +
          '<div class="gs-due-date">Due: ' + assignment.dueDateStr + '</div>';
        contentDiv.appendChild(el);
      });

    } catch (error) {
      console.error(error);
      contentDiv.innerHTML = '<div class="gs-loading" style="color: #e74c3c;">Error fetching data. Please try again.</div>';
    }
  }

  // Bind the fetch function to the refresh button
  document.getElementById('gs-tracker-refresh').addEventListener('click', fetchDeadlines);

  // Auto-fetch when the extension loads
  fetchDeadlines();
}

// Helper to parse Gradescope's date format (e.g., "OCT 25 AT 11:59PM")
function parseGradescopeDate(dateStr) {
  try {
    // If it's already an ISO string (from the datetime attribute), parse it directly
    if (dateStr.includes('T') && dateStr.includes('Z')) {
      var isoParsed = new Date(dateStr);
      if (!isNaN(isoParsed.getTime())) {
        return isoParsed.getTime();
      }
    }

    // Otherwise, parse the text format shown in the UI (e.g., "OCT 25 AT 11:59PM")
    // 1. Clean up the string
    var cleanStr = dateStr.replace(/LATE DUE DATE:/i, '').replace(/AT/i, '').trim();
    
    // 2. Extract month, day, time, and AM/PM
    // Example: "OCT 25 11:59PM" or "FEB 03 11:59PM"
    // Use regex \s+ to split by any amount of whitespace, since removing "AT" might leave double spaces
    var parts = cleanStr.split(/\s+/);
    if (parts.length < 3) return 0;

    var monthStr = parts[0]; // "OCT"
    var dayStr = parts[1];   // "25"
    var timeStr = parts[2];  // "11:59PM"

    // Map month string to number (0-11)
    var months = {
      'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
      'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };
    var month = months[monthStr.toUpperCase().substring(0, 3)];
    if (month === undefined) return 0;

    var day = parseInt(dayStr, 10);
    if (isNaN(day)) return 0;

    // Parse time (e.g., "11:59PM")
    var isPM = timeStr.toUpperCase().includes('PM');
    var timeParts = timeStr.replace(/AM|PM/i, '').split(':');
    var hours = parseInt(timeParts[0], 10);
    var minutes = timeParts.length > 1 ? parseInt(timeParts[1], 10) : 0;

    if (isNaN(hours) || isNaN(minutes)) return 0;

    // Convert to 24-hour format
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;

    // 3. Construct the date object
    var now = new Date();
    var currentYear = now.getFullYear();
    
    var parsedDate = new Date(currentYear, month, day, hours, minutes, 0, 0);
    
    // 4. Handle year boundaries (if it's December and deadline is January, it's next year)
    // Also handle the case where the date is in the past but should be next year
    if (now.getTime() - parsedDate.getTime() > 6 * 30 * 24 * 60 * 60 * 1000) {
      parsedDate.setFullYear(currentYear + 1);
    } else if (parsedDate.getTime() - now.getTime() > 6 * 30 * 24 * 60 * 60 * 1000) {
      parsedDate.setFullYear(currentYear - 1);
    }
    
    return parsedDate.getTime();
  } catch (e) {
    console.error("Failed to parse date:", dateStr, e);
    return 0;
  }
}

// Initialize when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTracker);
} else {
  initTracker();
}

// Also try to initialize after a short delay to handle dynamic page loads
setTimeout(initTracker, 1500);
setTimeout(initTracker, 3000);

